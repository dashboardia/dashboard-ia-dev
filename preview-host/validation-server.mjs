import { execFile as execFileCallback } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import {
  normalizeValidationConfiguration,
  validValidationId,
  validationContainerCreateArguments,
  validationContainerExecArguments,
  validationContainerName,
  validationStateIsTerminal,
} from "./validation-runtime.mjs";

const execFile = promisify(execFileCallback);
const port = Number(process.env.PORT || 8081);
const dataDirectory = process.env.VALIDATION_DATA_DIRECTORY || "/var/lib/dashboardia-validations";
const stateDirectory = path.join(dataDirectory, "state");
const workDirectory = path.join(dataDirectory, "work");
const token = process.env.PREVIEW_HOST_TOKEN || "";
const maxArchiveBytes = Number(process.env.VALIDATION_MAX_ARCHIVE_MB || 64) * 1024 * 1024;
const maxParallelValidations = Math.max(1, Math.min(8, Number(process.env.VALIDATION_MAX_PARALLEL || 2)));
const retentionMs = Math.max(1, Math.min(168, Number(process.env.VALIDATION_RETENTION_HOURS || 24))) * 60 * 60 * 1_000;
const maxOutputBytes = Math.max(8, Math.min(256, Number(process.env.VALIDATION_MAX_OUTPUT_KB || 96))) * 1024;
const validationQueue = [];
const activeContainers = new Map();
const cancelledValidations = new Set();
let activeValidations = 0;
let cleanupTimer = null;
let shuttingDown = false;

if (token.length < 32) throw new Error("PREVIEW_HOST_TOKEN precisa ter ao menos 32 caracteres");

class ValidationCancelledError extends Error {
  constructor() {
    super("Validação cancelada");
    this.name = "ValidationCancelledError";
  }
}

function statePath(id) {
  return path.join(stateDirectory, `${id}.json`);
}

function workPath(id) {
  return path.join(workDirectory, id);
}

function safeEqual(left, right) {
  const leftHash = createHash("sha256").update(String(left)).digest();
  const rightHash = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function authorized(request) {
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ") && safeEqual(authorization.slice(7), token);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function truncate(value, limit = maxOutputBytes) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}\n[saída truncada]` : text;
}

function redact(value) {
  return truncate(String(value ?? ""))
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/((?:Authorization|Proxy-Authorization):\s*(?:Basic|Bearer)\s+)[^\s'\"]+/gi, "$1[REDACTED]")
    .replace(/((?:x-access-token|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*)[^\s,'\";]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|access_token|api_key|key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]");
}

async function readState(id) {
  return JSON.parse(await readFile(statePath(id), "utf8"));
}

async function writeState(id, value) {
  const target = statePath(id);
  const temporary = `${target}.${process.pid}.tmp`;
  const state = { ...value, id, updatedAt: new Date().toISOString() };
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporary, target);
  return state;
}

async function patchState(id, values) {
  return writeState(id, { ...await readState(id), ...values });
}

async function runFile(command, args, options = {}) {
  return execFile(command, args, {
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    env: options.env ?? process.env,
  });
}

async function docker(args, timeout = 120_000) {
  return runFile("docker", args, { timeout });
}

function dockerErrorText(error) {
  return redact([error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n"));
}

function parseConfiguration(request) {
  const encoded = request.headers["x-dashboardia-validation"];
  if (!encoded || Array.isArray(encoded)) throw new Error("Metadados da validação ausentes");
  let value;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Metadados da validação inválidos");
  }
  return normalizeValidationConfiguration(value);
}

async function receiveArchive(request, target) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (!declaredLength || declaredLength > maxArchiveBytes) {
    throw new Error("Arquivo da validação ausente ou acima do limite");
  }
  let received = 0;
  request.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxArchiveBytes) request.destroy(new Error("Arquivo da validação acima do limite"));
  });
  await pipeline(request, createWriteStream(target, { mode: 0o600 }));
}

async function validateArchive(archivePath) {
  const listing = await runFile("tar", ["-tzf", archivePath], {
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error("Arquivo da validação está vazio");
  if (entries.length > 100_000) throw new Error("Arquivo da validação possui itens demais");
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized.length > 1_000
      || normalized.startsWith("/")
      || path.isAbsolute(normalized)
      || normalized.split("/").includes("..")
      || normalized.includes("\0")
    ) {
      throw new Error("Arquivo da validação contém caminho inseguro");
    }
  }
}

async function extractArchive(archivePath, sourceDirectory, configuration) {
  await validateArchive(archivePath);
  await mkdir(sourceDirectory, { recursive: true });
  const args = [
    "-xzf", archivePath,
    "-C", sourceDirectory,
    "--no-same-owner",
    "--no-same-permissions",
    "--delay-directory-restore",
  ];
  if (configuration.stripComponents === 1) args.push("--strip-components=1");
  await runFile("tar", args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
}

function sensitiveEntry(name) {
  const normalized = name.toLowerCase();
  if ([".git", ".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519"].includes(normalized)) return true;
  if (normalized === ".env" || normalized.startsWith(".env.")) {
    return ![".env.example", ".env.sample", ".env.template"].includes(normalized);
  }
  return false;
}

async function removeSensitiveEntries(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (sensitiveEntry(entry.name)) {
      await rm(target, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) await removeSensitiveEntries(target);
  }
}

async function assertWorkingDirectory(sourceDirectory, workingDirectory) {
  const sourceReal = await realpath(sourceDirectory);
  const target = path.resolve(sourceDirectory, workingDirectory);
  if (target !== sourceReal && !target.startsWith(`${sourceReal}${path.sep}`)) {
    throw new Error("Diretório de trabalho saiu do workspace isolado");
  }
  const information = await stat(target);
  if (!information.isDirectory()) throw new Error("Diretório de trabalho da validação não existe");
  const targetReal = await realpath(target);
  if (targetReal !== sourceReal && !targetReal.startsWith(`${sourceReal}${path.sep}`)) {
    throw new Error("Diretório de trabalho usa link fora do workspace isolado");
  }
}

async function imageAvailable(image) {
  try {
    await docker(["image", "inspect", image], 30_000);
    return true;
  } catch {
    return false;
  }
}

async function ensureImage(image) {
  if (await imageAvailable(image)) return;
  await docker(["pull", image], 10 * 60_000);
}

async function removeContainer(id) {
  const name = activeContainers.get(id) ?? validationContainerName(id);
  await docker(["rm", "--force", name], 60_000).catch(() => null);
  activeContainers.delete(id);
}

async function createValidationContainer(id, sourceDirectory, configuration) {
  const name = validationContainerName(id);
  await removeContainer(id);
  await ensureImage(configuration.image);
  await runFile("chown", ["-R", "--no-dereference", "1000:1000", sourceDirectory], { timeout: 90_000 });
  await docker(validationContainerCreateArguments(id, configuration), 120_000);
  activeContainers.set(id, name);
  await docker(["start", name], 60_000);
  await docker(["cp", "--archive", `${sourceDirectory}/.`, `${name}:/workspace/`], 5 * 60_000);
}

function commandResult(command, status, startedAt, output = {}) {
  return {
    scope: command.scope,
    status,
    durationMs: Date.now() - startedAt,
    stdout: redact(output.stdout),
    stderr: redact(output.stderr),
    exitCode: Number.isInteger(output.exitCode) ? output.exitCode : null,
    timedOut: Boolean(output.timedOut),
  };
}

async function executeValidationCommand(id, configuration, command) {
  const startedAt = Date.now();
  try {
    const result = await docker(
      validationContainerExecArguments(id, configuration, command),
      command.timeoutMs,
    );
    return commandResult(command, "PASSED", startedAt, result);
  } catch (error) {
    return commandResult(command, "FAILED", startedAt, {
      stdout: error?.stdout,
      stderr: error?.stderr || error?.message,
      exitCode: typeof error?.code === "number" ? error.code : null,
      timedOut: error?.killed || error?.code === "ETIMEDOUT",
    });
  }
}

async function runValidation(id, configuration) {
  const directory = workPath(id);
  const archivePath = path.join(directory, "source.tar.gz");
  const sourceDirectory = path.join(directory, "source");
  const results = [];
  try {
    if (cancelledValidations.has(id)) throw new ValidationCancelledError();
    await patchState(id, { status: "PREPARING", startedAt: new Date().toISOString(), error: null });
    await extractArchive(archivePath, sourceDirectory, configuration);
    await removeSensitiveEntries(sourceDirectory);
    await assertWorkingDirectory(sourceDirectory, configuration.workingDirectory);
    if (cancelledValidations.has(id)) throw new ValidationCancelledError();

    await createValidationContainer(id, sourceDirectory, configuration);
    await patchState(id, { status: "RUNNING", image: configuration.image });

    for (const command of configuration.commands) {
      if (cancelledValidations.has(id)) throw new ValidationCancelledError();
      await patchState(id, { currentScope: command.scope, results });
      const result = await executeValidationCommand(id, configuration, command);
      if (cancelledValidations.has(id)) throw new ValidationCancelledError();
      results.push(result);
      await patchState(id, { results });
      if (result.status !== "PASSED") {
        await patchState(id, {
          status: "FAILED",
          currentScope: null,
          finishedAt: new Date().toISOString(),
          error: result.timedOut
            ? `A validação ${command.scope} excedeu o limite de tempo`
            : `A validação ${command.scope} falhou`,
          results,
        });
        return;
      }
    }

    await patchState(id, {
      status: "SUCCEEDED",
      currentScope: null,
      finishedAt: new Date().toISOString(),
      error: null,
      results,
    });
  } catch (error) {
    const cancelled = error instanceof ValidationCancelledError || cancelledValidations.has(id);
    await patchState(id, {
      status: cancelled ? "CANCELLED" : "FAILED",
      currentScope: null,
      finishedAt: new Date().toISOString(),
      error: cancelled ? null : dockerErrorText(error) || "Falha interna na validação isolada",
      results,
    }).catch(() => null);
  } finally {
    await removeContainer(id);
    await rm(directory, { recursive: true, force: true }).catch(() => null);
    cancelledValidations.delete(id);
  }
}

function drainQueue() {
  while (!shuttingDown && activeValidations < maxParallelValidations && validationQueue.length) {
    const job = validationQueue.shift();
    if (cancelledValidations.has(job.id)) continue;
    activeValidations += 1;
    runValidation(job.id, job.configuration)
      .catch(console.error)
      .finally(() => {
        activeValidations -= 1;
        drainQueue();
      });
  }
}

function enqueueValidation(id, configuration) {
  validationQueue.push({ id, configuration });
  drainQueue();
}

async function cancelValidation(id) {
  cancelledValidations.add(id);
  const queueIndex = validationQueue.findIndex((job) => job.id === id);
  if (queueIndex >= 0) validationQueue.splice(queueIndex, 1);
  await removeContainer(id);
  const state = await readState(id).catch(() => null);
  if (state && !validationStateIsTerminal(state.status)) {
    await patchState(id, {
      status: "CANCELLED",
      currentScope: null,
      finishedAt: new Date().toISOString(),
      error: null,
    });
  }
  await rm(workPath(id), { recursive: true, force: true }).catch(() => null);
  return readState(id).catch(() => null);
}

async function cleanupExpired() {
  const files = await readdir(stateDirectory).catch(() => []);
  const now = Date.now();
  await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const id = file.slice(0, -5);
    const state = await readState(id).catch(() => null);
    if (!state) return;
    const expiresAt = new Date(state.expiresAt).getTime();
    if (expiresAt > now) return;
    if (!validationStateIsTerminal(state.status)) await cancelValidation(id).catch(() => null);
    await rm(statePath(id), { force: true });
    await rm(workPath(id), { recursive: true, force: true });
  }));
}

async function recoverInterruptedValidations() {
  const files = await readdir(stateDirectory).catch(() => []);
  await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const id = file.slice(0, -5);
    const state = await readState(id).catch(() => null);
    if (state && !validationStateIsTerminal(state.status)) {
      await removeContainer(id);
      await patchState(id, {
        status: "FAILED",
        currentScope: null,
        finishedAt: new Date().toISOString(),
        error: "O host de validações reiniciou durante a execução. Tente novamente.",
      });
      await rm(workPath(id), { recursive: true, force: true }).catch(() => null);
    }
  }));
}

async function handleValidationApi(request, response, url) {
  if (!authorized(request)) return sendJson(response, 401, { error: "Não autorizado" });
  const match = url.pathname.match(/^\/v1\/validations\/([a-zA-Z0-9_-]+)$/);
  if (!match || !validValidationId(match[1])) return sendJson(response, 404, { error: "Validação não encontrada" });
  const id = match[1];

  if (request.method === "GET") {
    const state = await readState(id).catch(() => null);
    return state ? sendJson(response, 200, state) : sendJson(response, 404, { error: "Validação não encontrada" });
  }

  if (request.method === "DELETE") {
    const state = await readState(id).catch(() => null);
    if (!state) return sendJson(response, 404, { error: "Validação não encontrada" });
    return sendJson(response, 200, await cancelValidation(id));
  }

  if (request.method !== "PUT") return sendJson(response, 405, { error: "Método não permitido" });
  const existing = await readState(id).catch(() => null);
  if (existing && !validationStateIsTerminal(existing.status)) {
    return sendJson(response, 409, { error: "Já existe uma validação ativa com este identificador" });
  }

  const configuration = parseConfiguration(request);
  const directory = workPath(id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  try {
    await receiveArchive(request, path.join(directory, "source.tar.gz"));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  cancelledValidations.delete(id);
  const now = new Date();
  const state = await writeState(id, {
    status: "QUEUED",
    runtime: configuration.runtime,
    image: configuration.image,
    workingDirectory: configuration.workingDirectory,
    scopes: configuration.commands.map((command) => command.scope),
    currentScope: null,
    results: [],
    error: null,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + retentionMs).toISOString(),
  });
  setImmediate(() => enqueueValidation(id, configuration));
  return sendJson(response, 202, state);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/health") {
      return sendJson(response, 200, {
        status: "ok",
        activeValidations,
        queuedValidations: validationQueue.length,
        timestamp: new Date().toISOString(),
      });
    }
    if (url.pathname.startsWith("/v1/validations/")) {
      return await handleValidationApi(request, response, url);
    }
    return sendJson(response, 404, { error: "Rota não encontrada" });
  } catch (error) {
    console.error("[validation-host]", error);
    return sendJson(response, 500, { error: "Falha interna no host de validações" });
  }
});

await mkdir(stateDirectory, { recursive: true });
await mkdir(workDirectory, { recursive: true });
await recoverInterruptedValidations();
await cleanupExpired();
cleanupTimer = setInterval(() => cleanupExpired().catch(console.error), 60_000);
cleanupTimer.unref();
server.listen(port, "0.0.0.0", () => console.log(`[validation-host] ouvindo na porta ${port}`));

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (cleanupTimer) clearInterval(cleanupTimer);
  await Promise.allSettled([...activeContainers.keys()].map((id) => cancelValidation(id)));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}
