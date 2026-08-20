import { execFile as execFileCallback } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  buildPreviewDockerfile,
  isTransientDockerError,
  isPreviewReadyStatus,
  previewUpstreamHeaders,
  previewContainerName,
  previewImageName,
  previewNetworkName,
  validPreviewId,
} from "./runtime.mjs";
import { applyKnownBuildRepairs } from "./build-repairs.mjs";
import { applyKnownRuntimeRepairs } from "./runtime-repairs.mjs";
import { expectedRepositoryPaths, normalizeExtractedRepository } from "./archive.mjs";

const execFile = promisify(execFileCallback);
const port = Number(process.env.PORT || 8080);
const dataDirectory = process.env.PREVIEW_DATA_DIRECTORY || "/var/lib/dashboardia-previews";
const stateDirectory = path.join(dataDirectory, "state");
const workDirectory = path.join(dataDirectory, "work");
const token = process.env.PREVIEW_HOST_TOKEN || "";
const baseDomain = process.env.PREVIEW_BASE_DOMAIN || "preview.dashboardia.app";
const apiDomain = String(process.env.PREVIEW_API_DOMAIN || `preview-api.${baseDomain}`).toLowerCase();
const hostContainerName = process.env.PREVIEW_HOST_CONTAINER_NAME || "dashboardia-preview-host";
const maxArchiveBytes = Number(process.env.PREVIEW_MAX_ARCHIVE_MB || 64) * 1024 * 1024;
const buildTimeoutMs = Number(process.env.PREVIEW_BUILD_TIMEOUT_MINUTES || 15) * 60_000;
const maxParallelBuilds = Math.max(1, Math.min(8, Number(process.env.PREVIEW_MAX_PARALLEL_BUILDS || 2)));
const buildQueue = [];
let activeBuilds = 0;

if (token.length < 32) throw new Error("PREVIEW_HOST_TOKEN precisa ter ao menos 32 caracteres");
if (!/^[a-z0-9.-]+$/i.test(baseDomain)) throw new Error("PREVIEW_BASE_DOMAIN inválido");

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

async function docker(args, timeout = 120_000) {
  return execFile("docker", args, { timeout, maxBuffer: 4 * 1024 * 1024 });
}

function dockerErrorText(error) {
  return [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
}

async function buildPreviewImage(id, generatedDockerfile, sourceDirectory) {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await patchState(id, { buildAttempt: attempt });
      await docker(["build", "--file", generatedDockerfile, "--tag", previewImageName(id), sourceDirectory], buildTimeoutMs);
      return;
    } catch (error) {
      if (attempt === maximumAttempts || !isTransientDockerError(error)) throw error;
      await patchState(id, {
        status: "BUILDING",
        error: `Falha transitória no Docker; nova tentativa ${attempt + 1} de ${maximumAttempts}.`,
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
}

function parseConfiguration(request) {
  const encoded = request.headers["x-dashboardia-preview"];
  if (!encoded || Array.isArray(encoded)) throw new Error("Metadados do preview ausentes");
  const configuration = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!configuration.previewCommand?.trim()) throw new Error("Comando de preview ausente");
  if (!Number.isInteger(configuration.port) || configuration.port < 1 || configuration.port > 65535) throw new Error("Porta do preview inválida");
  if (!Number.isInteger(configuration.ttlMinutes) || configuration.ttlMinutes < 5 || configuration.ttlMinutes > 1440) throw new Error("TTL do preview inválido");
  if (![0, 1].includes(configuration.stripComponents ?? 0)) throw new Error("Formato do arquivo compactado inválido");
  const workingDirectory = String(configuration.workingDirectory || ".");
  if (path.isAbsolute(workingDirectory) || workingDirectory.split(/[\\/]/).includes("..")) throw new Error("Diretório de trabalho inválido");
  configuration.workingDirectory = workingDirectory;
  return configuration;
}

async function receiveArchive(request, target) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (!declaredLength || declaredLength > maxArchiveBytes) throw new Error("Arquivo do preview ausente ou acima do limite");
  let received = 0;
  request.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxArchiveBytes) request.destroy(new Error("Arquivo do preview acima do limite"));
  });
  await pipeline(request, createWriteStream(target, { mode: 0o600 }));
}

async function removeRuntime(id, removeImage = true) {
  await docker(["rm", "--force", previewContainerName(id)]).catch(() => null);
  await docker(["network", "disconnect", "--force", previewNetworkName(id), hostContainerName]).catch(() => null);
  await docker(["network", "rm", previewNetworkName(id)]).catch(() => null);
  if (removeImage) await docker(["image", "rm", "--force", previewImageName(id)]).catch(() => null);
}

async function waitUntilReady(id, previewPort, timeoutMs = 90_000) {
  const startedAt = Date.now();
  const url = `http://${previewContainerName(id)}:${previewPort}/`;
  let lastHttpStatus = null;
  while (Date.now() - startedAt < timeoutMs) {
    const state = await docker(["inspect", "--format", "{{.State.Status}}", previewContainerName(id)]).catch(() => ({ stdout: "missing" }));
    if (state.stdout.trim() !== "running") {
      const logs = await docker(["logs", "--tail", "120", previewContainerName(id)]).catch(() => ({ stdout: "", stderr: "" }));
      throw new Error(`O container encerrou antes de ficar pronto\n${logs.stdout}${logs.stderr}`.slice(-12_000));
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
        redirect: "manual",
        headers: previewUpstreamHeaders({}, previewPort),
      });
      lastHttpStatus = response.status;
      if (isPreviewReadyStatus(response.status)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  const logs = await docker(["logs", "--tail", "160", previewContainerName(id)]).catch(() => ({ stdout: "", stderr: "" }));
  const diagnostic = `${logs.stdout || ""}${logs.stderr || ""}`.trim();
  throw new Error([
    "O container não publicou uma rota navegável dentro de 90 segundos.",
    lastHttpStatus ? `Última resposta HTTP recebida: ${lastHttpStatus}.` : null,
    diagnostic ? "Últimos logs do container:" : null,
    diagnostic || null,
  ].filter(Boolean).join("\n").slice(-16_000));
}

async function startPreviewRuntime(id, configuration) {
  await docker(["network", "create", "--internal", "--label", `dashboardia.preview.id=${id}`, previewNetworkName(id)]);
  await docker(["network", "connect", previewNetworkName(id), hostContainerName]);
  await docker([
    "run", "--detach", "--name", previewContainerName(id),
    "--network", previewNetworkName(id),
    "--memory", "768m", "--cpus", "1", "--pids-limit", "256",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
    "--env", `PORT=${configuration.port}`,
    "--env", "HOST=0.0.0.0", "--env", "HOSTNAME=0.0.0.0",
    "--label", `dashboardia.preview.id=${id}`,
    previewImageName(id),
  ]);
  await waitUntilReady(id, configuration.port);
}

async function deployPreview(id, configuration) {
  const directory = workPath(id);
  const sourceDirectory = path.join(directory, "source");
  try {
    const queuedState = await readState(id).catch(() => null);
    if (queuedState?.status !== "QUEUED" || new Date(queuedState.expiresAt).getTime() <= Date.now()) return;
    await patchState(id, { status: "BUILDING", startedAt: new Date().toISOString(), error: null });
    await mkdir(sourceDirectory, { recursive: true });
    const extractArguments = ["-xzf", path.join(directory, "source.tar.gz"), "-C", sourceDirectory, "--no-same-owner", "--no-same-permissions"];
    if (configuration.stripComponents === 1) extractArguments.push("--strip-components=1");
    await execFile("tar", extractArguments, { timeout: 90_000 });
    const normalizedDirectories = await normalizeExtractedRepository(sourceDirectory, expectedRepositoryPaths(configuration));
    if (normalizedDirectories.length) {
      await patchState(id, {
        adjustments: [{
          kind: "ARCHIVE_ROOT_NORMALIZED",
          message: `Estrutura do pacote ajustada: ${normalizedDirectories.join(" / ")} foi removido da raiz.`,
        }],
      });
    }
    const generatedDockerfile = path.join(directory, "Dockerfile");
    await writeFile(generatedDockerfile, buildPreviewDockerfile(configuration), { mode: 0o600 });
    await removeRuntime(id);
    try {
      await buildPreviewImage(id, generatedDockerfile, sourceDirectory);
    } catch (firstBuildError) {
      const buildAdjustments = await applyKnownBuildRepairs({
        sourceDirectory,
        buildOutput: dockerErrorText(firstBuildError),
      });
      if (!buildAdjustments.length) throw firstBuildError;
      const currentState = await readState(id).catch(() => null);
      await patchState(id, {
        status: "BUILDING",
        adjustments: [...(currentState?.adjustments ?? []), ...buildAdjustments],
        error: null,
      });
      await buildPreviewImage(id, generatedDockerfile, sourceDirectory);
    }
    const afterBuild = await readState(id).catch(() => null);
    if (!afterBuild || afterBuild.status !== "BUILDING" || new Date(afterBuild.expiresAt).getTime() <= Date.now()) {
      await removeRuntime(id);
      return;
    }
    const maximumRuntimeAttempts = 3;
    for (let attempt = 1; attempt <= maximumRuntimeAttempts; attempt += 1) {
      await patchState(id, { status: "DEPLOYING", imageReference: previewImageName(id), runtimeAttempt: attempt });
      try {
        await startPreviewRuntime(id, configuration);
        break;
      } catch (runtimeError) {
        const runtimeOutput = dockerErrorText(runtimeError);
        await removeRuntime(id);
        if (attempt === maximumRuntimeAttempts) throw runtimeError;
        const runtimeAdjustments = await applyKnownRuntimeRepairs({ sourceDirectory, runtimeOutput });
        if (!runtimeAdjustments.length) throw runtimeError;
        const currentState = await readState(id).catch(() => null);
        await patchState(id, {
          status: "BUILDING",
          adjustments: [...(currentState?.adjustments ?? []), ...runtimeAdjustments],
          error: null,
        });
        await buildPreviewImage(id, generatedDockerfile, sourceDirectory);
      }
    }
    await patchState(id, {
      status: "READY",
      readyAt: new Date().toISOString(),
      url: `https://${id}.${baseDomain}`,
      error: null,
    });
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    const buildOutput = dockerErrorText(error).slice(-16_000);
    await removeRuntime(id);
    await patchState(id, { status: "FAILED", error: buildOutput || "Falha desconhecida ao publicar o preview" }).catch(() => null);
    await rm(directory, { recursive: true, force: true }).catch(() => null);
  }
}

function drainBuildQueue() {
  while (activeBuilds < maxParallelBuilds && buildQueue.length) {
    const job = buildQueue.shift();
    activeBuilds += 1;
    deployPreview(job.id, job.configuration)
      .catch(console.error)
      .finally(() => {
        activeBuilds -= 1;
        drainBuildQueue();
      });
  }
}

function enqueuePreview(id, configuration) {
  buildQueue.push({ id, configuration });
  drainBuildQueue();
}

async function expirePreview(id, state) {
  if (["EXPIRED", "FAILED"].includes(state.status)) return;
  await patchState(id, { status: "STOPPING" });
  await removeRuntime(id);
  await patchState(id, { status: "EXPIRED", url: null, stoppedAt: new Date().toISOString() });
  await rm(workPath(id), { recursive: true, force: true });
}

async function cleanupExpired() {
  const files = await readdir(stateDirectory).catch(() => []);
  const now = Date.now();
  await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const id = file.slice(0, -5);
    const state = await readState(id).catch(() => null);
    if (!state) return;
    if (new Date(state.expiresAt).getTime() <= now) await expirePreview(id, state).catch(() => null);
  }));
}

async function recoverInterruptedBuilds() {
  const files = await readdir(stateDirectory).catch(() => []);
  await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const id = file.slice(0, -5);
    const state = await readState(id).catch(() => null);
    if (state && ["QUEUED", "BUILDING", "DEPLOYING"].includes(state.status)) {
      await removeRuntime(id);
      await patchState(id, { status: "FAILED", error: "O host de previews reiniciou durante a publicação. Solicite uma nova execução." });
    }
  }));
}

async function handleApi(request, response, url) {
  if (!authorized(request)) return sendJson(response, 401, { error: "Não autorizado" });
  const match = url.pathname.match(/^\/v1\/previews\/([a-zA-Z0-9_-]+)$/);
  if (!match || !validPreviewId(match[1])) return sendJson(response, 404, { error: "Preview não encontrado" });
  const id = match[1];

  if (request.method === "GET") {
    const state = await readState(id).catch(() => null);
    return state ? sendJson(response, 200, state) : sendJson(response, 404, { error: "Preview não encontrado" });
  }
  if (request.method === "DELETE") {
    const state = await readState(id).catch(() => null);
    if (!state) return sendJson(response, 404, { error: "Preview não encontrado" });
    await expirePreview(id, state);
    return sendJson(response, 200, await readState(id));
  }
  if (request.method !== "PUT") return sendJson(response, 405, { error: "Método não permitido" });

  const configuration = parseConfiguration(request);
  const directory = workPath(id);
  await removeRuntime(id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await receiveArchive(request, path.join(directory, "source.tar.gz"));
  const now = new Date();
  const state = await writeState(id, {
    status: "QUEUED",
    runtime: configuration.runtime,
    workingDirectory: configuration.workingDirectory,
    port: configuration.port,
    imageReference: null,
    url: null,
    error: null,
    adjustments: [],
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + configuration.ttlMinutes * 60_000).toISOString(),
  });
  setImmediate(() => enqueuePreview(id, configuration));
  return sendJson(response, 202, state);
}

async function proxyPreview(request, response, state) {
  const upstream = http.request({
    hostname: previewContainerName(state.id),
    port: state.port,
    method: request.method,
    path: request.url,
    headers: previewUpstreamHeaders(request.headers, state.port),
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) sendJson(response, 502, { error: "O container temporário não respondeu" });
    else response.destroy();
  });
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const host = String(request.headers.host || "").split(":")[0].toLowerCase();
    if (url.pathname === "/health" && host === apiDomain) {
      return sendJson(response, 200, { status: "ok", timestamp: new Date().toISOString() });
    }
    if (url.pathname === "/tls-ask") {
      const domain = String(url.searchParams.get("domain") || "").toLowerCase();
      if (domain === apiDomain) {
        response.writeHead(200).end();
        return;
      }
      const suffix = `.${baseDomain}`;
      if (!domain.endsWith(suffix)) return response.writeHead(403).end();
      const id = domain.slice(0, -suffix.length);
      const state = validPreviewId(id) ? await readState(id).catch(() => null) : null;
      if (state?.status === "READY" && new Date(state.expiresAt).getTime() > Date.now()) return response.writeHead(200).end();
      return response.writeHead(403).end();
    }
    if (url.pathname.startsWith("/v1/")) return await handleApi(request, response, url);
    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) return sendJson(response, 404, { error: "Preview não encontrado" });
    const id = host.slice(0, -suffix.length);
    if (!validPreviewId(id)) return sendJson(response, 404, { error: "Preview não encontrado" });
    const state = await readState(id).catch(() => null);
    if (!state || state.status !== "READY" || new Date(state.expiresAt).getTime() <= Date.now()) {
      return sendJson(response, 404, { error: "Preview indisponível ou expirado" });
    }
    return await proxyPreview(request, response, state);
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Falha interna" });
  }
});

server.on("upgrade", async (request, socket, head) => {
  try {
    const host = String(request.headers.host || "").split(":")[0];
    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) return socket.destroy();
    const id = host.slice(0, -suffix.length);
    const state = await readState(id);
    if (state.status !== "READY") return socket.destroy();
    const upstream = http.request({
      hostname: previewContainerName(id),
      port: state.port,
      method: request.method,
      path: request.url,
      headers: previewUpstreamHeaders(request.headers, state.port),
    });
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstreamResponse.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  } catch {
    socket.destroy();
  }
});

await mkdir(stateDirectory, { recursive: true });
await mkdir(workDirectory, { recursive: true });
await recoverInterruptedBuilds();
await cleanupExpired();
const cleanupTimer = setInterval(() => cleanupExpired().catch(console.error), 30_000);
cleanupTimer.unref();
server.listen(port, "0.0.0.0", () => console.log(`[preview-host] ouvindo na porta ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
