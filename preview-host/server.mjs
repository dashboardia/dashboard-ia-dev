import { execFile as execFileCallback } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  buildPreviewDockerfile,
  isOpenApiDocumentPath,
  isTransientDockerError,
  isPreviewReadyStatus,
  probePreviewHttp,
  railpackPrepareArguments,
  previewUpstreamHeaders,
  previewUpstreamPath,
  previewResponseHeaders,
  previewContainerName,
  previewEgressNetworkCreateArguments,
  previewEgressNetworkName,
  previewImageName,
  previewNetworkCreateArguments,
  previewNetworkName,
  rewriteOpenApiDocument,
  validPreviewId,
} from "./runtime.mjs";
import { applyKnownBuildRepairs } from "./build-repairs.mjs";
import { prepareDemoAccess } from "./demo-access.mjs";
import { verifyOrCreateDemoAccess } from "./demo-verification.mjs";
import { applyKnownRuntimeRepairs } from "./runtime-repairs.mjs";
import { ensureRustToolchainVersion } from "./railpack.mjs";
import { expectedRepositoryPaths, normalizeExtractedRepository } from "./archive.mjs";
import { interruptedBuildRecoveryDecision, nextReadyFailure } from "./interrupted-build-recovery.mjs";

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
const allowOutboundNetwork = String(process.env.PREVIEW_ALLOW_OUTBOUND_NETWORK || "true").toLowerCase() !== "false";
const proxyTimeoutMs = Math.max(10, Number(process.env.PREVIEW_PROXY_TIMEOUT_SECONDS || 60)) * 1_000;
const readyHealthCheckIntervalMs = 15_000;
const readyFailureThreshold = 3;
const readyFailureGraceMs = Math.max(15, Number(process.env.PREVIEW_READY_FAILURE_GRACE_SECONDS || 30)) * 1_000;
const buildQueue = [];
const failingReadyPreviews = new Set();
const recoveringReadyPreviews = new Set();
const readyFailureCounts = new Map();
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

async function recordActivity(id, key, message, status = "RUNNING") {
  const state = await readState(id);
  const now = new Date().toISOString();
  const activity = (Array.isArray(state.activity) ? state.activity : []).map((entry) => (
    entry.status === "RUNNING" && entry.key !== key ? { ...entry, status: "COMPLETED", completedAt: now } : entry
  )).filter((entry) => entry.key !== key);
  const entry = { key, message, status, at: now, ...(status !== "RUNNING" ? { completedAt: now } : {}) };
  activity.push(entry);
  return writeState(id, { ...state, activity: activity.slice(-10) });
}

async function failActivity(id, message) {
  const state = await readState(id);
  const now = new Date().toISOString();
  const activity = (Array.isArray(state.activity) ? state.activity : []).map((entry) => (
    entry.status === "RUNNING" ? { ...entry, status: "FAILED", completedAt: now } : entry
  ));
  activity.push({ key: "failed", message, status: "FAILED", at: now, completedAt: now });
  return writeState(id, { ...state, activity: activity.slice(-10) });
}

async function docker(args, timeout = 120_000, environment = null) {
  return execFile("docker", args, {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    ...(environment ? { env: { ...process.env, ...environment } } : {}),
  });
}

async function inspectPreviewRuntime(id) {
  const inspected = await docker(["inspect", "--format", "{{json .State}}", previewContainerName(id)], 15_000).catch(() => null);
  if (!inspected?.stdout?.trim()) return null;
  try {
    return JSON.parse(inspected.stdout.trim());
  } catch {
    return null;
  }
}

async function previewRuntimeLogs(id) {
  const logs = await docker(["logs", "--tail", "200", previewContainerName(id)], 15_000).catch(() => ({ stdout: "", stderr: "" }));
  return `${logs.stdout || ""}${logs.stderr || ""}`.trim().slice(-12_000);
}

function clearReadyFailures(id) {
  for (const key of readyFailureCounts.keys()) {
    if (key.startsWith(`${id}:`)) readyFailureCounts.delete(key);
  }
}

async function markReadyPreviewFailed(id, { failureClass = "APPLICATION", message, diagnostic = "" }) {
  if (failingReadyPreviews.has(id)) return;
  failingReadyPreviews.add(id);
  try {
    const state = await readState(id).catch(() => null);
    if (!state || state.status !== "READY") return;
    const runtime = await inspectPreviewRuntime(id);
    const logs = await previewRuntimeLogs(id);
    const details = [
      message,
      runtime ? `Estado do container: ${runtime.Status || "desconhecido"}; saída: ${runtime.ExitCode ?? "n/a"}; OOM: ${runtime.OOMKilled === true ? "sim" : "não"}.` : "O container não foi encontrado no host.",
      diagnostic,
      logs ? `Últimos logs do container:\n${logs}` : null,
    ].filter(Boolean).join("\n").slice(-16_000);
    await patchState(id, {
      status: "FAILED",
      url: null,
      credentials: null,
      stoppedAt: new Date().toISOString(),
      error: `[${failureClass}] ${details}`,
    });
    await failActivity(id, "O ambiente deixou de responder; o erro foi disponibilizado para uma nova tentativa com IA").catch(() => null);
    await removeRuntime(id);
  } finally {
    clearReadyFailures(id);
    failingReadyPreviews.delete(id);
  }
}

async function recordReadyFailure(id, field, failure) {
  const state = await readState(id).catch(() => null);
  if (!state || state.status !== "READY") return;
  const key = `${id}:${field}`;
  const decision = nextReadyFailure(readyFailureCounts.get(key), Date.now(), {
    threshold: readyFailureThreshold,
    graceMs: readyFailureGraceMs,
  });
  readyFailureCounts.set(key, decision.record);
  if (!decision.shouldRecover) return;
  recoverReadyPreview(id, failure).catch(console.error);
}

async function clearReadyFailure(id, field) {
  readyFailureCounts.delete(`${id}:${field}`);
}

async function recoverReadyPreview(id, failure) {
  if (recoveringReadyPreviews.has(id) || failingReadyPreviews.has(id)) return;
  recoveringReadyPreviews.add(id);
  try {
    const state = await readState(id).catch(() => null);
    if (!state || state.status !== "READY") return;
    const runtime = await inspectPreviewRuntime(id);
    if (!runtime) {
      await markReadyPreviewFailed(id, {
        failureClass: "INFRASTRUCTURE",
        message: "O ambiente deixou de responder e o container não foi encontrado para recuperação.",
        diagnostic: String(failure?.message || failure || "Container ausente").slice(-4_000),
      });
      return;
    }

    await recordActivity(id, "recovering-ready", "A aplicação oscilou; reiniciando automaticamente o mesmo ambiente");
    try {
      await docker(["restart", previewContainerName(id)], 60_000);
      const entryPath = await waitUntilReady(id, state.port, 90_000);
      await patchState(id, {
        status: "READY",
        entryPath,
        url: `https://${id}.${baseDomain}`,
        stoppedAt: null,
        error: null,
      });
      await recordActivity(id, "ready", "Ambiente recuperado automaticamente e pronto para uso", "COMPLETED");
      clearReadyFailures(id);
    } catch (recoveryError) {
      await markReadyPreviewFailed(id, {
        failureClass: "APPLICATION",
        message: "A aplicação parou de responder e não voltou após a reinicialização automática do container.",
        diagnostic: dockerErrorText(recoveryError).slice(-4_000),
      });
    }
  } finally {
    recoveringReadyPreviews.delete(id);
  }
}

async function checkReadyRuntime(id, state) {
  const runtime = await inspectPreviewRuntime(id);
  if (!runtime) {
    await markReadyPreviewFailed(id, {
      failureClass: "INFRASTRUCTURE",
      message: "O estado do ambiente indicava que ele estava pronto, mas o container não existe mais no host.",
    });
    return false;
  }
  if (runtime.Status !== "running") {
    await recordReadyFailure(id, "healthFailureCount", new Error(`Container em estado ${runtime.Status || "desconhecido"}`));
    return false;
  }
  try {
    const status = await probePreviewHttp(previewContainerName(id), state.port, state.entryPath || "/", 5_000);
    if (!isPreviewReadyStatus(status)) throw new Error(`A aplicação respondeu HTTP ${status}`);
    await clearReadyFailure(id, "healthFailureCount");
    return true;
  } catch (error) {
    await recordReadyFailure(id, "healthFailureCount", error);
    return false;
  }
}

function dockerErrorText(error) {
  return [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
}

async function buildPreviewImage(id, buildFile, sourceDirectory, runtime) {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await patchState(id, { buildAttempt: attempt });
      if (runtime === "RAILPACK") {
        const planFile = path.join(path.dirname(buildFile), "railpack-plan.json");
        const infoFile = path.join(path.dirname(buildFile), "railpack-info.json");
        await ensureRustToolchainVersion(sourceDirectory);
        await execFile("railpack", railpackPrepareArguments({ sourceDirectory, planFile, infoFile }), {
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        await docker([
          "build",
          "--build-arg", `BUILDKIT_SYNTAX=${process.env.RAILPACK_FRONTEND_IMAGE || "ghcr.io/railwayapp/railpack-frontend"}`,
          "--build-arg", `cache-key=${id}`,
          "--file", planFile,
          "--tag", previewImageName(id),
          sourceDirectory,
        ], buildTimeoutMs, { DOCKER_BUILDKIT: "1" });
      } else {
        await docker(["build", "--file", buildFile, "--tag", previewImageName(id), sourceDirectory], buildTimeoutMs);
      }
      return;
    } catch (error) {
      const transientRailpackPreparation = runtime === "RAILPACK" && Number(error?.code) === 75;
      if (attempt === maximumAttempts || (!transientRailpackPreparation && !isTransientDockerError(error))) throw error;
      await patchState(id, {
        status: "BUILDING",
        error: `Falha transitória no Docker; nova tentativa ${attempt + 1} de ${maximumAttempts}.`,
      });
      await recordActivity(id, "building", `Falha transitória no Docker; repetindo o build (${attempt + 1}/${maximumAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
}

async function projectDockerfile(sourceDirectory) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  const dockerfile = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === "dockerfile");
  if (!dockerfile) throw new Error("A stack Dockerfile foi detectada, mas o arquivo não existe na raiz do projeto.");
  return path.join(sourceDirectory, dockerfile.name);
}

function validateConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new Error("Metadados do preview inválidos");
  if (!configuration.previewCommand?.trim()) throw new Error("Comando de preview ausente");
  if (!Number.isInteger(configuration.port) || configuration.port < 1 || configuration.port > 65535) throw new Error("Porta do preview inválida");
  if (configuration.auxiliaryPreviewCommand != null) {
    if (typeof configuration.auxiliaryPreviewCommand !== "string" || !configuration.auxiliaryPreviewCommand.trim()) throw new Error("Comando auxiliar inválido");
    if (!Number.isInteger(configuration.auxiliaryPreviewPort) || configuration.auxiliaryPreviewPort < 1 || configuration.auxiliaryPreviewPort > 65535 || configuration.auxiliaryPreviewPort === configuration.port) throw new Error("Porta auxiliar inválida");
  }
  if (!Number.isInteger(configuration.ttlMinutes) || configuration.ttlMinutes < 5 || configuration.ttlMinutes > 1440) throw new Error("TTL do preview inválido");
  if (![0, 1].includes(configuration.stripComponents ?? 0)) throw new Error("Formato do arquivo compactado inválido");
  const workingDirectory = String(configuration.workingDirectory || ".");
  if (path.isAbsolute(workingDirectory) || workingDirectory.split(/[\\/]/).includes("..")) throw new Error("Diretório de trabalho inválido");
  configuration.workingDirectory = workingDirectory;
  if (configuration.demoCredentials != null) {
    const { username, email, password } = configuration.demoCredentials;
    if (![username, email, password].every((value) => typeof value === "string" && value.length >= 3 && value.length <= 160)) {
      throw new Error("Credenciais temporárias inválidas");
    }
    configuration.demoCredentials = { username, email, password };
  }
  return configuration;
}

function parseConfiguration(request) {
  const encoded = request.headers["x-dashboardia-preview"];
  if (!encoded || Array.isArray(encoded)) throw new Error("Metadados do preview ausentes");
  return validateConfiguration(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
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
  await docker(["network", "rm", previewEgressNetworkName(id)]).catch(() => null);
  if (removeImage) await docker(["image", "rm", "--force", previewImageName(id)]).catch(() => null);
}

async function ensurePreviewEgressNetwork(id) {
  if (!allowOutboundNetwork) return;
  const name = previewEgressNetworkName(id);
  const existing = await docker(["network", "inspect", name], 15_000).catch(() => null);
  if (!existing) await docker(previewEgressNetworkCreateArguments(id));
  await docker(["network", "connect", "--gw-priority", "1", name, previewContainerName(id)]).catch(async (error) => {
    if (/already exists|endpoint with name/i.test(dockerErrorText(error))) return;
    if (/unknown flag|unknown option/i.test(dockerErrorText(error))) {
      await docker(["network", "connect", name, previewContainerName(id)]);
      return;
    }
    throw error;
  });
}

async function waitUntilReady(id, previewPort, timeoutMs = 90_000) {
  const startedAt = Date.now();
  const hostname = previewContainerName(id);
  const candidatePaths = ["/", "/index.html"];
  let lastHttpStatus = null;
  while (Date.now() - startedAt < timeoutMs) {
    const state = await docker(["inspect", "--format", "{{.State.Status}}", previewContainerName(id)]).catch(() => ({ stdout: "missing" }));
    if (state.stdout.trim() !== "running") {
      const logs = await docker(["logs", "--tail", "120", previewContainerName(id)]).catch(() => ({ stdout: "", stderr: "" }));
      throw new Error(`O container encerrou antes de ficar pronto\n${logs.stdout}${logs.stderr}`.slice(-12_000));
    }
    try {
      for (const candidatePath of candidatePaths) {
        lastHttpStatus = await probePreviewHttp(hostname, previewPort, candidatePath);
        if (isPreviewReadyStatus(lastHttpStatus)) return candidatePath;
      }
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
  await docker(previewNetworkCreateArguments(id));
  await docker(["network", "connect", previewNetworkName(id), hostContainerName]);
  const runtimeEnvironment = Object.entries(configuration.runtimeEnvironment ?? {})
    .flatMap(([name, value]) => ["--env", `${name}=${value}`]);
  await docker([
    "create", "--name", previewContainerName(id),
    "--network", previewNetworkName(id),
    "--restart", "unless-stopped",
    "--memory", "768m", "--cpus", "1", "--pids-limit", "256",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
    "--env", `PORT=${configuration.port}`,
    "--env", "HOST=0.0.0.0", "--env", "HOSTNAME=0.0.0.0",
    ...runtimeEnvironment,
    "--label", `dashboardia.preview.id=${id}`,
    previewImageName(id),
  ]);
  await ensurePreviewEgressNetwork(id);
  await docker(["start", previewContainerName(id)], 60_000);
  return waitUntilReady(id, configuration.port);
}

async function seedPreviewRuntime(id, command) {
  if (!command?.trim()) return;
  await docker(["exec", previewContainerName(id), "/bin/sh", "-lc", command], 180_000);
}

async function deployPreview(id, configuration) {
  const directory = workPath(id);
  const sourceDirectory = path.join(directory, "source");
  try {
    const queuedState = await readState(id).catch(() => null);
    if (queuedState?.status !== "QUEUED" || new Date(queuedState.expiresAt).getTime() <= Date.now()) return;
    await patchState(id, { status: "BUILDING", startedAt: new Date().toISOString(), error: null });
    await recordActivity(id, "extracting", "Extraindo e organizando o código da branch");
    await mkdir(sourceDirectory, { recursive: true });
    const extractArguments = ["-xzf", path.join(directory, "source.tar.gz"), "-C", sourceDirectory, "--no-same-owner", "--no-same-permissions"];
    if (configuration.stripComponents === 1) extractArguments.push("--strip-components=1");
    await execFile("tar", extractArguments, { timeout: 90_000 });
    const normalizedDirectories = await normalizeExtractedRepository(sourceDirectory, expectedRepositoryPaths(configuration));
    await recordActivity(id, "detecting", `Stack ${configuration.runtime} detectada; preparando comandos e variáveis`);
    if (normalizedDirectories.length) {
      await patchState(id, {
        adjustments: [{
          kind: "ARCHIVE_ROOT_NORMALIZED",
          message: `Estrutura do pacote ajustada: ${normalizedDirectories.join(" / ")} foi removido da raiz.`,
        }],
      });
    }
    const demoAccess = await prepareDemoAccess({
      sourceDirectory,
      workingDirectory: configuration.workingDirectory,
      credentials: configuration.demoCredentials,
    });
    configuration.runtimeEnvironment = demoAccess.environment;
    configuration.demoSeedCommand = demoAccess.seedCommand;
    configuration.demoAccessCredentials = demoAccess.credentials;
    if (demoAccess.credentials) {
      const currentState = await readState(id).catch(() => null);
      await patchState(id, {
        adjustments: [...(currentState?.adjustments ?? []), ...demoAccess.adjustments],
      });
    }
    const imageManagedRuntime = ["DOCKERFILE", "RAILPACK"].includes(configuration.runtime);
    const buildFile = configuration.runtime === "DOCKERFILE"
      ? await projectDockerfile(sourceDirectory)
      : path.join(directory, "Dockerfile");
    if (!imageManagedRuntime) await writeFile(buildFile, buildPreviewDockerfile(configuration), { mode: 0o600 });
    await removeRuntime(id);
    await recordActivity(id, "building", "Instalando dependências e construindo a imagem Docker");
    try {
      await buildPreviewImage(id, buildFile, sourceDirectory, configuration.runtime);
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
      await recordActivity(id, "repairing", "Aplicando correções temporárias para concluir o build");
      await recordActivity(id, "building", "Reconstruindo a imagem com os ajustes temporários");
      await buildPreviewImage(id, buildFile, sourceDirectory, configuration.runtime);
    }
    const afterBuild = await readState(id).catch(() => null);
    if (!afterBuild || afterBuild.status !== "BUILDING" || new Date(afterBuild.expiresAt).getTime() <= Date.now()) {
      await removeRuntime(id);
      return;
    }
    const maximumRuntimeAttempts = 3;
    let entryPath = "/";
    for (let attempt = 1; attempt <= maximumRuntimeAttempts; attempt += 1) {
      await patchState(id, { status: "DEPLOYING", imageReference: previewImageName(id), runtimeAttempt: attempt });
      await recordActivity(id, "starting", `Iniciando o container isolado${attempt > 1 ? ` (tentativa ${attempt})` : ""}`);
      try {
        await recordActivity(id, "checking", "Verificando a porta e procurando uma rota navegável");
        entryPath = await startPreviewRuntime(id, configuration);
        if (configuration.demoSeedCommand) {
          await recordActivity(id, "seeding", "Criando a massa de dados e o acesso de demonstração");
          await seedPreviewRuntime(id, configuration.demoSeedCommand);
        }
        if (configuration.demoAccessCredentials?.password) {
          await recordActivity(id, "verifying-demo-access", "Validando o acesso de demonstração pela API do ambiente");
          const preparedCredentials = configuration.demoAccessCredentials;
          const verification = await verifyOrCreateDemoAccess({
            hostname: previewContainerName(id),
            port: configuration.port,
            credentials: preparedCredentials,
          });
          if (!verification.verified) {
            const logs = await docker(["logs", "--tail", "240", previewContainerName(id)]).catch(() => ({ stdout: "", stderr: "" }));
            const runtimeOutput = [verification.technicalDiagnostic, logs.stdout, logs.stderr].filter(Boolean).join("\n");
            if (attempt < maximumRuntimeAttempts) {
              const runtimeAdjustments = await applyKnownRuntimeRepairs({ sourceDirectory, runtimeOutput });
              if (runtimeAdjustments.length) {
                const currentState = await readState(id).catch(() => null);
                await patchState(id, {
                  status: "BUILDING",
                  adjustments: [...(currentState?.adjustments ?? []), ...runtimeAdjustments],
                  error: null,
                });
                await recordActivity(id, "repairing-demo-access", `Corrigindo a autenticação demonstrativa (tentativa ${attempt + 1}/${maximumRuntimeAttempts})`);
                await removeRuntime(id);
                await recordActivity(id, "building-demo-access", "Reconstruindo o ambiente para validar novamente o login");
                await buildPreviewImage(id, buildFile, sourceDirectory, configuration.runtime);
                continue;
              }
            }
            configuration.demoAccessCredentials = verification.credentials;
            const currentState = await readState(id).catch(() => null);
            await patchState(id, {
              adjustments: [...(currentState?.adjustments ?? []), {
                code: "DEMO_ACCESS_VERIFICATION_FAILED",
                file: "API de autenticação do ambiente",
                summary: `O acesso preparado não foi exibido porque a autenticação não foi confirmada (${verification.diagnostic}).`,
              }],
            });
            await recordActivity(id, "verifying-demo-access", "A API não confirmou as credenciais demonstrativas", "FAILED");
          } else {
            configuration.demoAccessCredentials = verification.credentials;
            await recordActivity(id, "verifying-demo-access", "Acesso de demonstração criado e validado", "COMPLETED");
          }
        }
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
        await recordActivity(id, "repairing-runtime", "Ajustando a inicialização com base nos logs do container");
        await recordActivity(id, "building-runtime", "Reconstruindo a imagem após o ajuste de inicialização");
        await buildPreviewImage(id, buildFile, sourceDirectory, configuration.runtime);
      }
    }
    await recordActivity(id, "ready", "Ambiente publicado e pronto para uso", "COMPLETED");
    await patchState(id, {
      status: "READY",
      readyAt: new Date().toISOString(),
      url: `https://${id}.${baseDomain}`,
      entryPath,
      credentials: configuration.demoAccessCredentials,
      recoveryConfiguration: null,
      error: null,
    });
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    const buildOutput = dockerErrorText(error).slice(-16_000);
    await removeRuntime(id);
    await patchState(id, { status: "FAILED", credentials: null, recoveryConfiguration: null, error: buildOutput || "Falha desconhecida ao publicar o preview" }).catch(() => null);
    await failActivity(id, "A publicação falhou; os detalhes técnicos estão disponíveis abaixo").catch(() => null);
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
  await recordActivity(id, "stopping", "Encerrando e removendo os recursos temporários");
  await removeRuntime(id);
  await recordActivity(id, "expired", "Ambiente temporário encerrado", "COMPLETED");
  await patchState(id, { status: "EXPIRED", url: null, credentials: null, stoppedAt: new Date().toISOString() });
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
    const archivePath = path.join(workPath(id), "source.tar.gz");
    const archiveAvailable = await access(archivePath).then(() => true).catch(() => false);
    const decision = interruptedBuildRecoveryDecision(state, archiveAvailable);
    if (decision.action === "IGNORE") return;
    await removeRuntime(id);
    if (decision.action === "RESUME") {
      await rm(path.join(workPath(id), "source"), { recursive: true, force: true }).catch(() => null);
      let configuration;
      try {
        configuration = validateConfiguration(structuredClone(decision.configuration));
      } catch {
        await patchState(id, { status: "FAILED", credentials: null, recoveryConfiguration: null, error: "O host reiniciou e os metadados preservados da publicação não eram válidos para uma retomada segura." });
        await failActivity(id, "A publicação interrompida não pôde ser retomada com segurança").catch(() => null);
        return;
      }
      await patchState(id, {
        status: "QUEUED",
        startedAt: null,
        imageReference: null,
        credentials: null,
        error: null,
      });
      await recordActivity(id, "resuming", "Host reiniciado; retomando automaticamente a publicação preservada");
      enqueuePreview(id, configuration);
      return;
    }
    await patchState(id, { status: "FAILED", credentials: null, recoveryConfiguration: null, error: "O host de previews reiniciou durante a publicação e os dados necessários para retomá-la não estavam disponíveis." });
    await failActivity(id, "A publicação foi interrompida e não pôde ser retomada automaticamente").catch(() => null);
  }));
}

async function reconnectReadyPreviewNetworks() {
  const files = await readdir(stateDirectory).catch(() => []);
  const now = Date.now();
  await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const id = file.slice(0, -5);
    const state = await readState(id).catch(() => null);
    if (!state || state.status !== "READY" || new Date(state.expiresAt).getTime() <= now) return;
    const runtime = await inspectPreviewRuntime(id);
    if (!runtime) {
      await markReadyPreviewFailed(id, {
        failureClass: "INFRASTRUCTURE",
        message: "O host reiniciou, mas o container anteriormente marcado como pronto não foi encontrado.",
      });
      return;
    }
    await docker(["network", "connect", previewNetworkName(id), hostContainerName]).catch((error) => {
      if (!/already exists|endpoint with name/i.test(dockerErrorText(error))) console.error(error);
    });
    await ensurePreviewEgressNetwork(id).catch((error) => console.error(error));
    if (runtime.Status !== "running") await docker(["start", previewContainerName(id)], 60_000).catch(() => null);
    await checkReadyRuntime(id, state);
  }));
}

async function checkReadyPreviewHealth() {
  const files = await readdir(stateDirectory).catch(() => []);
  await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const id = file.slice(0, -5);
    const state = await readState(id).catch(() => null);
    if (!state || state.status !== "READY" || new Date(state.expiresAt).getTime() <= Date.now()) return;
    await checkReadyRuntime(id, state);
  }));
}

async function handleApi(request, response, url) {
  if (!authorized(request)) return sendJson(response, 401, { error: "Não autorizado" });
  const match = url.pathname.match(/^\/v1\/previews\/([a-zA-Z0-9_-]+)$/);
  if (!match || !validPreviewId(match[1])) return sendJson(response, 404, { error: "Preview não encontrado" });
  const id = match[1];

  if (request.method === "GET") {
    let state = await readState(id).catch(() => null);
    if (state?.status === "READY") {
      await checkReadyRuntime(id, state);
      state = await readState(id).catch(() => state);
    }
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
    credentials: null,
    recoveryConfiguration: configuration,
    error: null,
    adjustments: [],
    activity: [{ key: "queued", message: "Código recebido e aguardando uma vaga para o build", status: "RUNNING", at: now.toISOString() }],
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + configuration.ttlMinutes * 60_000).toISOString(),
  });
  setImmediate(() => enqueuePreview(id, configuration));
  return sendJson(response, 202, state);
}

async function proxyPreview(request, response, state) {
  const rewriteOpenApi = request.method === "GET" && isOpenApiDocumentPath(request.url);
  const upstreamHeaders = previewUpstreamHeaders(request.headers, state.port);
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const publicOrigin = `${["http", "https"].includes(forwardedProto) ? forwardedProto : "https"}://${request.headers.host}`;
  if (rewriteOpenApi) upstreamHeaders["accept-encoding"] = "identity";
  const upstream = http.request({
    hostname: previewContainerName(state.id),
    port: state.port,
    method: request.method,
    path: previewUpstreamPath(request.url, state.entryPath),
    headers: upstreamHeaders,
  }, (upstreamResponse) => {
    const contentType = String(upstreamResponse.headers["content-type"] || "");
    const encoded = Boolean(upstreamResponse.headers["content-encoding"]);
    if (!rewriteOpenApi || !/json/i.test(contentType) || encoded) {
      response.writeHead(upstreamResponse.statusCode || 502, previewResponseHeaders(upstreamResponse.headers, publicOrigin));
      upstreamResponse.pipe(response);
      return;
    }

    const chunks = [];
    let size = 0;
    upstreamResponse.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 8 * 1024 * 1024) chunks.push(chunk);
    });
    upstreamResponse.on("end", () => {
      if (size > 8 * 1024 * 1024) return sendJson(response, 502, { error: "Documento OpenAPI excede o limite de 8 MB" });
      const body = Buffer.from(rewriteOpenApiDocument(Buffer.concat(chunks).toString("utf8"), publicOrigin));
      const headers = { ...previewResponseHeaders(upstreamResponse.headers, publicOrigin), "content-length": String(body.length) };
      delete headers["transfer-encoding"];
      response.writeHead(upstreamResponse.statusCode || 502, headers);
      response.end(body);
    });
  });
  upstream.setTimeout(proxyTimeoutMs, () => upstream.destroy(new Error(`A aplicação não respondeu em ${Math.round(proxyTimeoutMs / 1_000)} segundos`)));
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
await reconnectReadyPreviewNetworks();
const cleanupTimer = setInterval(() => cleanupExpired().catch(console.error), 30_000);
cleanupTimer.unref();
const readyHealthTimer = setInterval(() => checkReadyPreviewHealth().catch(console.error), readyHealthCheckIntervalMs);
readyHealthTimer.unref();
server.listen(port, "0.0.0.0", () => console.log(`[preview-host] ouvindo na porta ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
