import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { applyDiff } from "@openai/agents";

import { redactSensitiveData } from "../lib/redaction.js";

export { redactSensitiveData } from "../lib/redaction.js";

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 24_000;

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

function safeChildEnvironment(workspace) {
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
        output.push({ stdout: truncate(result.stdout, action.maxOutputLength), stderr: truncate(result.stderr, action.maxOutputLength), outcome: { type: "exit", exitCode: 0 } });
      } catch (error) {
        output.push({ stdout: truncate(error.stdout, action.maxOutputLength), stderr: truncate(error.stderr || error.message, action.maxOutputLength), outcome: error.killed ? { type: "timeout" } : { type: "exit", exitCode: error.code ?? 1 } });
      }
    }
    return { output, maxOutputLength: Math.min(action.maxOutputLength ?? MAX_OUTPUT, MAX_OUTPUT) };
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

export async function runConfiguredCommand(command, workspace, timeout = 10 * 60_000) {
  if (!command?.trim()) return null;
  if (/(^|\s)(sudo|su|docker|kubectl|railway|ssh|scp|nc)(\s|$)/.test(command)) {
    throw new Error(`Comando de validação bloqueado: ${command}`);
  }
  const tempDirectory = path.join(workspace, ".tmp");
  await mkdir(tempDirectory, { recursive: true });
  const result = await exec(command, {
    cwd: workspace,
    env: safeChildEnvironment(workspace),
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    shell: "/bin/bash",
  });
  return { stdout: truncate(result.stdout, 80_000), stderr: truncate(result.stderr, 80_000) };
}

export async function cleanWorkspace(workspace) {
  await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
}

export function gitAuthenticationArgs(token) {
  const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${authorization}`];
}
