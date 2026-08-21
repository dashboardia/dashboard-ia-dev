import { execFile as execFileCallback } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { redactSensitiveData } from "../lib/redaction.js";
import { safeChildEnvironment } from "./sandbox.mjs";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 24_000;
const MAX_TIMEOUT_MS = 60_000;
const PROTECTED_PATH = /(^|\/)(?:\.git|node_modules|\.forgeboard-venv|\.tmp)(?:\/|$)|(^|\/)\.env(?:\.[^/]*)?$|(^|\/)\.github\/workflows(?:\/|$)/i;

class ReadCommandBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReadCommandBlockedError";
  }
}

function truncate(value, limit = MAX_OUTPUT) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}\n[saída truncada]` : text;
}

export function tokenizeRepositoryReadCommand(command) {
  const value = String(command ?? "").trim();
  if (!value || /[\n\r;&|><`$]/.test(value)) {
    throw new ReadCommandBlockedError(`Comando bloqueado pela política do worker: ${command}`);
  }

  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (escaped || quote) throw new ReadCommandBlockedError("Comando de leitura com aspas inválidas");
  if (current) tokens.push(current);
  return tokens;
}

function assertSafeRepositoryValue(value, { allowOption = false } = {}) {
  if (!value || /[\n\r\0]/.test(value)) throw new ReadCommandBlockedError("Argumento de leitura inválido");
  if (!allowOption && value.startsWith("-")) throw new ReadCommandBlockedError(`Opção não permitida: ${value}`);
  if (path.isAbsolute(value) || value.replaceAll("\\", "/").split("/").includes("..")) {
    throw new ReadCommandBlockedError(`Caminho fora do workspace: ${value}`);
  }
  if (PROTECTED_PATH.test(value.replaceAll("\\", "/"))) {
    throw new ReadCommandBlockedError(`Caminho protegido: ${value}`);
  }
  return value;
}

async function assertNoSymlinkEscape(workspace, relativePath = ".") {
  const normalized = String(relativePath || ".").replaceAll("\\", "/");
  assertSafeRepositoryValue(normalized);
  let current = path.resolve(workspace);
  for (const segment of normalized.split("/").filter((value) => value && value !== ".")) {
    current = path.join(current, segment);
    const information = await lstat(current);
    if (information.isSymbolicLink()) throw new ReadCommandBlockedError(`Link simbólico não permitido: ${relativePath}`);
  }
}

function validateLs(args) {
  const paths = [];
  for (const argument of args) {
    if (argument.startsWith("-")) {
      if (!/^-[alh]+$/.test(argument) && argument !== "--all") {
        throw new ReadCommandBlockedError(`Opção de ls não permitida: ${argument}`);
      }
    } else paths.push(assertSafeRepositoryValue(argument));
  }
  return { args, paths: paths.length ? paths : ["."] };
}

function validateFind(args) {
  const result = [];
  let index = 0;
  if (args[0] && !args[0].startsWith("-")) {
    result.push(assertSafeRepositoryValue(args[0]));
    index = 1;
  } else result.push(".");

  while (index < args.length) {
    const option = args[index];
    if (option === "-maxdepth") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 20) throw new ReadCommandBlockedError("-maxdepth inválido");
      result.push(option, String(value));
      index += 2;
      continue;
    }
    if (option === "-type") {
      const value = args[index + 1];
      if (!new Set(["f", "d"]).has(value)) throw new ReadCommandBlockedError("-type permite somente f ou d");
      result.push(option, value);
      index += 2;
      continue;
    }
    if (option === "-name" || option === "-path") {
      const value = args[index + 1];
      if (!value || /[\n\r\0]/.test(value)) throw new ReadCommandBlockedError(`${option} inválido`);
      result.push(option, value);
      index += 2;
      continue;
    }
    throw new ReadCommandBlockedError(`Opção de find não permitida: ${option}`);
  }

  return {
    args: [
      ...result,
      "-not", "-path", "*/.git/*",
      "-not", "-path", "*/node_modules/*",
      "-not", "-path", "*/.forgeboard-venv/*",
      "-not", "-name", ".env",
      "-not", "-name", ".env.*",
    ],
    paths: [result[0]],
  };
}

function validateSearch(command, args) {
  const allowedFlags = new Set([
    "-n", "--line-number", "-i", "--ignore-case", "-l", "--files-with-matches",
    "-F", "--fixed-strings", "-S", "--smart-case", "--files", "-r", "--recursive", "--",
  ]);
  const result = [];
  let expectsGlob = false;
  let seenSeparator = false;

  for (const argument of args) {
    if (expectsGlob) {
      if (!argument || /[\n\r\0]/.test(argument)) throw new ReadCommandBlockedError("Glob inválido");
      result.push(argument);
      expectsGlob = false;
      continue;
    }
    if (!seenSeparator && (argument === "-g" || argument === "--glob")) {
      if (command !== "rg") throw new ReadCommandBlockedError(`${argument} não é permitido em grep`);
      result.push(argument);
      expectsGlob = true;
      continue;
    }
    if (!seenSeparator && argument.startsWith("-")) {
      if (!allowedFlags.has(argument)) throw new ReadCommandBlockedError(`Opção de ${command} não permitida: ${argument}`);
      result.push(argument);
      if (argument === "--") seenSeparator = true;
      continue;
    }
    if (path.isAbsolute(argument) || argument.replaceAll("\\", "/").split("/").includes("..")) {
      throw new ReadCommandBlockedError(`Caminho fora do workspace: ${argument}`);
    }
    if (PROTECTED_PATH.test(argument.replaceAll("\\", "/"))) {
      throw new ReadCommandBlockedError(`Caminho protegido: ${argument}`);
    }
    result.push(argument);
  }
  if (expectsGlob) throw new ReadCommandBlockedError("Glob ausente");

  const filesMode = command === "rg" && result.includes("--files");
  const positional = result.filter((argument, index) => {
    if (argument.startsWith("-")) return false;
    const previous = result[index - 1];
    return previous !== "-g" && previous !== "--glob";
  });
  const paths = filesMode ? positional : positional.slice(1);
  return {
    args: command === "rg"
      ? ["--glob", "!.git/**", "--glob", "!node_modules/**", "--glob", "!.env", "--glob", "!.env.*", ...result]
      : ["--exclude=.env", "--exclude=.env.*", "--exclude-dir=.git", "--exclude-dir=node_modules", ...result],
    paths: paths.length ? paths : ["."],
  };
}

function validateLineReader(command, args) {
  if (command === "sed") {
    if (args.length !== 3 || args[0] !== "-n" || !/^\d+(?:,\d+)?p$/.test(args[1])) {
      throw new ReadCommandBlockedError("sed permite somente leitura por intervalo, por exemplo: sed -n '1,120p' arquivo");
    }
    assertSafeRepositoryValue(args[2]);
    return { args, paths: [args[2]] };
  }
  if (command === "wc") {
    if (args.length !== 2 || args[0] !== "-l") throw new ReadCommandBlockedError("wc permite somente wc -l arquivo");
    assertSafeRepositoryValue(args[1]);
    return { args, paths: [args[1]] };
  }

  let file;
  if (args[0] === "-n") {
    const count = Number(args[1]);
    if (!Number.isInteger(count) || count < 0 || count > 2_000 || args.length !== 3) {
      throw new ReadCommandBlockedError(`${command} recebeu argumentos inválidos`);
    }
    file = args[2];
  } else if (/^-\d+$/.test(args[0] ?? "")) {
    const count = Number(args[0].slice(1));
    if (count > 2_000 || args.length !== 2) throw new ReadCommandBlockedError(`${command} recebeu argumentos inválidos`);
    file = args[1];
  } else {
    if (args.length !== 1) throw new ReadCommandBlockedError(`${command} recebeu argumentos inválidos`);
    file = args[0];
  }
  assertSafeRepositoryValue(file);
  return { args, paths: [file] };
}

function validateGit(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) throw new ReadCommandBlockedError("Subcomando git ausente");

  const allowedByCommand = {
    status: new Set(["--short", "--porcelain", "--porcelain=v1", "--porcelain=v2", "--branch", "-s", "-b", "-sb"]),
    diff: new Set(["--stat", "--name-only", "--name-status", "--cached", "--staged", "--color=never", "--word-diff=plain", "--no-ext-diff", "--"]),
    log: new Set(["--oneline", "--stat", "--decorate", "--no-decorate", "--all", "--graph", "--name-only", "--name-status", "-1", "-2", "-3", "-5", "-10", "-20", "-50", "--"]),
    show: new Set(["--oneline", "--stat", "--name-only", "--name-status", "--color=never", "--no-patch", "--"]),
    "ls-files": new Set(["--cached", "--modified", "--deleted", "--others", "--exclude-standard", "--stage", "--"]),
    grep: new Set(["-n", "-i", "-l", "--line-number", "--ignore-case", "--files-with-matches", "--"]),
  };

  if (subcommand === "branch") {
    if (rest.join(" ") !== "--show-current") throw new ReadCommandBlockedError("git branch permite somente --show-current");
  } else if (subcommand === "rev-parse") {
    if (!new Set(["HEAD", "--show-toplevel", "--show-prefix", "--show-cdup", "--is-inside-work-tree", "--abbrev-ref HEAD"]).has(rest.join(" "))) {
      throw new ReadCommandBlockedError("Argumentos de git rev-parse não permitidos");
    }
  } else if (allowedByCommand[subcommand]) {
    let separator = false;
    for (const argument of rest) {
      if (/[\n\r\0]/.test(argument)) throw new ReadCommandBlockedError("Argumento git inválido");
      if (argument === "--") {
        separator = true;
        continue;
      }
      if (!separator && argument.startsWith("-")) {
        const allowed = allowedByCommand[subcommand].has(argument)
          || (/^(?:-U\d|--unified=\d+|--max-count=\d+|--since=.+|--until=.+)$/.test(argument) && new Set(["diff", "log", "show"]).has(subcommand));
        if (!allowed) throw new ReadCommandBlockedError(`Opção git não permitida: ${argument}`);
      } else if (path.isAbsolute(argument) || PROTECTED_PATH.test(argument.replaceAll("\\", "/"))) {
        throw new ReadCommandBlockedError(`Caminho git não permitido: ${argument}`);
      }
    }
  } else {
    throw new ReadCommandBlockedError(`Subcomando git não permitido: ${subcommand}`);
  }

  return ["-c", "core.pager=cat", "-c", "diff.external=", "-c", "core.hooksPath=/dev/null", subcommand, ...rest];
}

function executableFor(tokens) {
  const [command, ...args] = tokens;
  if (command === "pwd") {
    if (args.length) throw new ReadCommandBlockedError("pwd não aceita argumentos");
    return { internal: "pwd" };
  }
  if (command === "ls") return { command, ...validateLs(args) };
  if (command === "find") return { command, ...validateFind(args) };
  if (command === "rg" || command === "grep") return { command, ...validateSearch(command, args) };
  if (["sed", "head", "tail", "wc"].includes(command)) return { command, ...validateLineReader(command, args) };
  if (command === "git") return { command, args: validateGit(args) };
  throw new ReadCommandBlockedError(`Comando bloqueado pela política do worker: ${command}`);
}

export class RepositoryReadShell {
  constructor(workspace) {
    this.workspace = path.resolve(workspace);
  }

  async run(action) {
    const maxOutputLength = action.maxOutputLength ?? MAX_OUTPUT;
    const outputLimit = Math.min(maxOutputLength, MAX_OUTPUT);
    const output = [];

    for (const rawCommand of action.commands) {
      try {
        const executable = executableFor(tokenizeRepositoryReadCommand(rawCommand));
        if (executable.internal === "pwd") {
          output.push({ stdout: `${this.workspace}\n`, stderr: "", outcome: { type: "exit", exitCode: 0 } });
          continue;
        }
        await Promise.all((executable.paths ?? []).map((repositoryPath) => assertNoSymlinkEscape(this.workspace, repositoryPath)));
        const result = await execFile(executable.command, executable.args, {
          cwd: this.workspace,
          env: { ...safeChildEnvironment(this.workspace), GIT_PAGER: "cat", GIT_CONFIG_NOSYSTEM: "1" },
          timeout: Math.min(action.timeoutMs ?? 30_000, MAX_TIMEOUT_MS),
          maxBuffer: 2 * 1024 * 1024,
        });
        output.push({
          stdout: truncate(redactSensitiveData(result.stdout), outputLimit),
          stderr: truncate(redactSensitiveData(result.stderr), outputLimit),
          outcome: { type: "exit", exitCode: 0 },
        });
      } catch (error) {
        const blocked = error instanceof ReadCommandBlockedError;
        output.push({
          stdout: truncate(redactSensitiveData(error?.stdout), outputLimit),
          stderr: truncate(redactSensitiveData(error?.stderr || error?.message), outputLimit),
          outcome: error?.killed
            ? { type: "timeout" }
            : { type: "exit", exitCode: blocked ? 126 : Number.isInteger(error?.code) ? error.code : 1 },
        });
      }
    }

    return { output, maxOutputLength };
  }
}
