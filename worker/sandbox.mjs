import { exec as execCallback, execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { applyDiff } from "@openai/agents";

import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { detectWorkspaceProjectRuntime } from "../lib/project-runtime.js";
import { redactSensitiveData } from "../lib/redaction.js";

export { redactSensitiveData } from "../lib/redaction.js";

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 24_000;
const VALIDATION_TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const isolatedValidationJobs = new Map();

function truncate(value, limit = MAX_OUTPUT) {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}\n[saída truncada]` : value;
}

export function resolveWorkspacePath(workspace, relativePath = ".") {
  if (path.isAbsolute(relativePath)) throw new Error("Caminho absoluto não permitido");
  const resolvedWorkspace = path.resolve(workspace);
  const resolved = path.resolve(workspace, relativePath);
  if (resolved !== resolvedWorkspace && !resolved.startsWith(`${resolvedWorkspace}${path.sep}`)) {
    throw new Error("Caminho fora do workspace");
  }
  return resolved;
}

function assertPatchPath(workspace, relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("Caminho de patch inválido");
  }
  if (/^(\.git|\.env|\.npmrc|\.pypirc)(\/|$)/.test(normalized) || normalized.startsWith(".github/workflows/")) {
    throw new Error(`Arquivo protegido: ${normalized}`);
  }
  return resolveWorkspacePath(workspace, normalized);
}

export class WorkspaceEditor {
  constructor(workspace) {
    this.workspace = workspace;
  }

  async createFile(operation) {
    try {
      const target = assertPatchPath(this.workspace, operation.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, applyDiff("", operation.diff, "create"), { flag: "wx" });
      return { status: "completed", output: `Criado ${operation.path}` };
    } catch (error) {
      return { status: "failed", output: error.message };
    }
  }

  async updateFile(operation) {
    try {
      const target = assertPatchPath(this.workspace, operation.path);
      const current = await readFile(target, "utf8");
      await writeFile(target, applyDiff(current, operation.diff));
      return { status: "completed", output: `Atualizado ${operation.path}` };
    } catch (error) {
      return { status: "failed", output: error.message };
    }
  }

  async deleteFile(operation) {
    try {
      const target = assertPatchPath(this.workspace, operation.path);
      await unlink(target);
      return { status: "completed", output: `Excluído ${operation.path}` };
    } catch (error) {
      return { status: "failed", output: error.message };
    }
  }
}

export function safeChildEnvironment(workspace) {
  return {
    PATH: process.env.PATH,
    HOME: workspace,
    TMPDIR: path.join(workspace, ".tmp"),
    CI: "true",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    JAVA_HOME: process.env.JAVA_HOME,
    MAVEN_HOME: process.env.MAVEN_HOME,
    GRADLE_HOME: process.env.GRADLE_HOME,
  };
}

function isAllowedReadCommand(command) {
  const trimmed = command.trim();
  if (!trimmed || /[\n\r;&|><`$]/.test(trimmed)) return false;
  if (/(^|\s)(\.env|\.git\/config|node_modules)(\s|$|\/)/.test(trimmed)) return false;
  if (/^sed(\s|$)/.test(trimmed) && /(^|\s)(-\S*i\S*|--in-place(?:=\S*)?)(\s|$)/.test(trimmed)) return false;
  if (/^pwd$/.test(trimmed)) return true;
  if (/^(ls|rg|grep|sed|head|tail|wc)(\s|$)/.test(trimmed)) return true;
  if (/^find(\s|$)/.test(trimmed) && !/-(exec|execdir|delete|ok|okdir)\b/.test(trimmed)) return true;
  return /^git\s+(status|diff|log|show|ls-files|grep|rev-parse|branch\s+--show-current)(\s|$)/.test(trimmed);
}

export class ReadOnlyShell {
  constructor(workspace) {
    this.workspace = workspace;
  }

  async run(action) {
    const maxOutputLength = action.maxOutputLength ?? MAX_OUTPUT;
    const outputLimit = Math.min(maxOutputLength, MAX_OUTPUT);
    const output = [];
    for (const command of action.commands) {
      if (!isAllowedReadCommand(command)) {
        output.push({ stdout: "", stderr: `Comando bloqueado pela política do worker: ${command}`, outcome: { type: "exit", exitCode: 126 } });
        continue;
      }
      try {
        const result = await exec(command, {
          cwd: this.workspace,
          env: safeChildEnvironment(this.workspace),
          timeout: Math.min(action.timeoutMs ?? 30_000, 60_000),
          maxBuffer: 2 * 1024 * 1024,
          shell: "/bin/bash",
        });
        output.push({ stdout: truncate(result.stdout, outputLimit), stderr: truncate(result.stderr, outputLimit), outcome: { type: "exit", exitCode: 0 } });
      } catch (error) {
        output.push({ stdout: truncate(error.stdout, outputLimit), stderr: truncate(error.stderr || error.message, outputLimit), outcome: error.killed ? { type: "timeout" } : { type: "exit", exitCode: error.code ?? 1 } });
      }
    }
    return { output, maxOutputLength };
  }
}

export async function runProcess(command, args, options = {}) {
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd,
      env: options.env ?? safeChildEnvironment(options.cwd),
      timeout: options.timeout ?? 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: truncate(result.stdout, 200_000), stderr: truncate(result.stderr, 200_000) };
  } catch (error) {
    const secrets = options.secrets ?? [];
    const sanitized = new Error(redactSensitiveData(error.message, secrets));
    sanitized.code = error.code;
    sanitized.killed = error.killed;
    sanitized.stdout = redactSensitiveData(error.stdout, secrets);
    sanitized.stderr = redactSensitiveData(error.stderr, secrets);
    throw sanitized;
  }
}

function executeShellProcess(command, { cwd, env, timeout, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-c", command], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let terminationError = null;
    let forceKillTimer = null;

    const append = (current, chunk) => (current + chunk).slice(-8 * 1024 * 1024);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString()); });

    function killProcessTree(error) {
      if (terminationError) return;
      terminationError = error;
      terminationError.killed = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      forceKillTimer = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 2_000);
      forceKillTimer.unref();
    }

    const timeoutTimer = setTimeout(() => {
      const error = new Error(`Comando excedeu o limite de ${Math.round(timeout / 60_000)} minutos`);
      error.code = "ETIMEDOUT";
      killProcessTree(error);
    }, timeout);
    timeoutTimer.unref();

    const abort = () => killProcessTree(new Error("Comando cancelado pelo Gestor"));
    signal?.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
      if (terminationError) {
        terminationError.stdout = stdout;
        terminationError.stderr = stderr;
        reject(terminationError);
        return;
      }
      if (code !== 0) {
        const error = new Error(`Comando encerrou com código ${code ?? childSignal ?? "desconhecido"}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function usesPython(command) {
  return /(^|\s)(python3?|pip3?|pytest|flask|uvicorn|gunicorn|django-admin|ruff|black|mypy|poetry)(\s|$)/.test(command);
}

async function pythonEnvironment(workspace, command) {
  const virtualEnvironment = path.join(workspace, ".forgeboard-venv");
  const python = path.join(virtualEnvironment, "bin", "python");
  let exists = true;
  try {
    await access(python);
  } catch {
    exists = false;
  }

  if (!exists && usesPython(command)) {
    await runProcess("python3", ["-m", "venv", virtualEnvironment], { cwd: workspace });
    exists = true;
  }

  return exists ? {
    PATH: `${path.join(virtualEnvironment, "bin")}:${process.env.PATH}`,
    VIRTUAL_ENV: virtualEnvironment,
    PIP_NO_CACHE_DIR: "1",
  } : {};
}

function executionWorkspaceContext(workspace) {
  const resolved = path.resolve(workspace);
  const marker = `${path.sep}forgeboard-workspaces${path.sep}`;
  const markerIndex = resolved.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  const suffix = resolved.slice(markerIndex + marker.length);
  const [executionId] = suffix.split(path.sep);
  if (!executionId) return null;
  const repositoryRoot = resolved.slice(0, markerIndex + marker.length + executionId.length);
  return { executionId, repositoryRoot };
}

function validationHostUrl(pathname) {
  if (!env.PREVIEW_HOST_URL || !env.PREVIEW_HOST_TOKEN) {
    throw new Error("Host de validações isoladas não configurado no worker");
  }
  return new URL(pathname, env.PREVIEW_HOST_URL).toString();
}

async function validationHostRequest(pathname, options = {}) {
  const response = await fetch(validationHostUrl(pathname), {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    headers: {
      Authorization: `Bearer ${env.PREVIEW_HOST_TOKEN}`,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error ?? `Host de validações respondeu HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function cancelIsolatedValidation(job) {
  if (!job?.id || job.cancelled) return;
  job.cancelled = true;
  await validationHostRequest(`/v1/validations/${encodeURIComponent(job.id)}`, {
    method: "DELETE",
    timeoutMs: 30_000,
  }).catch(() => null);
}

async function createValidationArchive(repositoryRoot, validationId) {
  const archivePath = path.join(os.tmpdir(), `${validationId}.tar.gz`);
  await rm(archivePath, { force: true });
  try {
    await runProcess("git", ["archive", "--format=tar.gz", "-o", archivePath, "HEAD"], {
      cwd: repositoryRoot,
      timeout: 120_000,
    });
    return await readFile(archivePath);
  } finally {
    await rm(archivePath, { force: true }).catch(() => null);
  }
}

function configuredValidationCommands(project, timeoutMs) {
  const commandTimeoutMs = Math.max(1_000, Math.min(30 * 60_000, Number(timeoutMs) || 10 * 60_000));
  return [
    ["install", project.installCommand],
    ["lint", project.lintCommand],
    ["test", project.testCommand],
    ["build", project.buildCommand],
  ].filter(([, command]) => command?.trim()).map(([scope, command]) => ({
    scope,
    command: String(command).trim(),
    timeoutMs: commandTimeoutMs,
  }));
}

async function createIsolatedValidationJob(workspace, timeout, nodeMemoryMb) {
  const context = executionWorkspaceContext(workspace);
  if (!context) throw new Error("Não foi possível identificar a execução para validação isolada");
  const head = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: context.repositoryRoot })).stdout.trim();
  const key = `${context.executionId}:${head}`;
  const cached = isolatedValidationJobs.get(key);
  if (cached) return cached;

  const execution = await db.execution.findUnique({
    where: { id: context.executionId },
    include: { demand: { include: { project: true } } },
  });
  if (!execution?.demand?.project) throw new Error("Execução não encontrada para validação isolada");

  const commands = configuredValidationCommands(execution.demand.project, timeout);
  if (!commands.length) throw new Error("Nenhum comando disponível para validação isolada");
  const detected = await detectWorkspaceProjectRuntime(context.repositoryRoot);
  const validationId = `validation_${context.executionId.slice(-20).replace(/[^a-zA-Z0-9_-]/g, "")}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const archive = await createValidationArchive(context.repositoryRoot, validationId);
  const configuredMemoryMb = Math.max(256, Math.min(4096, Number(nodeMemoryMb) || 1024));
  const metadata = Buffer.from(JSON.stringify({
    runtime: detected.runtime,
    workingDirectory: execution.demand.project.workingDirectory || ".",
    commands,
    memoryMb: configuredMemoryMb,
    workspaceMb: 2048,
    cpuLimit: 1,
    pidsLimit: 256,
    networkMode: "bridge",
    stripComponents: 0,
  })).toString("base64url");

  await validationHostRequest(`/v1/validations/${encodeURIComponent(validationId)}`, {
    method: "PUT",
    body: archive,
    timeoutMs: 90_000,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(archive.byteLength),
      "X-Dashboardia-Validation": metadata,
    },
  });

  const job = {
    id: validationId,
    key,
    commands,
    deliveredScopes: new Set(),
    cancelled: false,
  };
  isolatedValidationJobs.set(key, job);
  return job;
}

function validationCommandForInvocation(job, command) {
  return job.commands.find((entry) => entry.command === command.trim() && !job.deliveredScopes.has(entry.scope))
    ?? job.commands.find((entry) => entry.command === command.trim());
}

function validationFailure(result, fallbackMessage) {
  const message = result?.timedOut
    ? `Comando excedeu o limite de tempo na validação isolada`
    : fallbackMessage || "A validação isolada falhou";
  const error = new Error(message);
  error.code = result?.exitCode ?? (result?.timedOut ? "ETIMEDOUT" : 1);
  error.killed = Boolean(result?.timedOut);
  error.stdout = result?.stdout ?? "";
  error.stderr = result?.stderr ?? message;
  return error;
}

async function runIsolatedConfiguredCommand(command, workspace, timeout, signal, nodeMemoryMb) {
  const job = await createIsolatedValidationJob(workspace, timeout, nodeMemoryMb);
  const expected = validationCommandForInvocation(job, command);
  if (!expected) throw new Error(`Comando não pertence ao plano de validação isolada: ${command}`);

  const deadline = Date.now() + Math.max(timeout, 60_000) + 5 * 60_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await cancelIsolatedValidation(job);
      const error = new Error("Comando cancelado pelo Gestor");
      error.killed = true;
      throw error;
    }

    const state = await validationHostRequest(`/v1/validations/${encodeURIComponent(job.id)}`);
    const result = Array.isArray(state.results)
      ? state.results.find((entry) => entry.scope === expected.scope)
      : null;
    if (result) {
      job.deliveredScopes.add(expected.scope);
      if (result.status === "PASSED") {
        return {
          stdout: truncate(result.stdout, 80_000),
          stderr: truncate(result.stderr, 80_000),
        };
      }
      throw validationFailure(result, state.error);
    }

    if (state.status === "CANCELLED") {
      const error = new Error("Comando cancelado pelo Gestor");
      error.killed = true;
      throw error;
    }
    if (VALIDATION_TERMINAL_STATUSES.has(state.status)) {
      throw validationFailure(null, state.error || `A validação ${expected.scope} não produziu resultado`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_250));
  }

  await cancelIsolatedValidation(job);
  const error = new Error(`Comando excedeu o limite de ${Math.round(timeout / 60_000)} minutos`);
  error.code = "ETIMEDOUT";
  error.killed = true;
  throw error;
}

export async function runConfiguredCommand(command, workspace, timeout = 10 * 60_000, signal, nodeMemoryMb) {
  if (!command?.trim()) return null;
  if (/(^|\s)(sudo|su|docker|kubectl|railway|ssh|scp|nc)(\s|$)/.test(command)) {
    throw new Error(`Comando de validação bloqueado: ${command}`);
  }

  if (env.NODE_ENV === "production") {
    return runIsolatedConfiguredCommand(command, workspace, timeout, signal, nodeMemoryMb);
  }

  const tempDirectory = path.join(workspace, ".tmp");
  await mkdir(tempDirectory, { recursive: true });
  const runtimeEnvironment = await pythonEnvironment(workspace, command);
  const result = await executeShellProcess(command, {
    cwd: workspace,
    env: { ...safeChildEnvironment(workspace), ...runtimeEnvironment, ...(nodeMemoryMb ? { NODE_OPTIONS: `--max-old-space-size=${nodeMemoryMb}` } : {}) },
    timeout,
    signal,
  });
  return { stdout: truncate(result.stdout, 80_000), stderr: truncate(result.stderr, 80_000) };
}

export async function cleanWorkspace(workspace) {
  await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
}

export async function cleanValidationArtifacts(projectDirectory) {
  await Promise.all([
    rm(path.join(projectDirectory, ".forgeboard-venv"), { recursive: true, force: true, maxRetries: 3 }),
    rm(path.join(projectDirectory, ".tmp"), { recursive: true, force: true, maxRetries: 3 }),
  ]);
}

export async function restoreImplementationSnapshot(workspace, commitSha) {
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("Commit de implementação inválido");
  await runProcess("git", ["reset", "--hard", commitSha], { cwd: workspace });
  await runProcess("git", ["clean", "-fdx"], { cwd: workspace });
}

export function gitAuthenticationArgs(token) {
  const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${authorization}`];
}
