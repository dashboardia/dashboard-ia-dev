import path from "node:path";

const VALIDATION_SCOPES = new Set(["install", "lint", "test", "build"]);
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function integer(value, fallback, minimum, maximum, label) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} deve ser um inteiro entre ${minimum} e ${maximum}`);
  }
  return resolved;
}

function number(value, fallback, minimum, maximum, label) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} deve estar entre ${minimum} e ${maximum}`);
  }
  return resolved;
}

export function validValidationId(value) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(String(value || ""));
}

export function validationContainerName(id) {
  if (!validValidationId(id)) throw new Error("Identificador de validação inválido");
  return `dashboardia-validation-${id}`;
}

export function validationRuntimeImage(runtime) {
  const value = String(runtime || "NODE").toUpperCase();
  if (value.startsWith("PYTHON_")) return "python:3.12-bookworm";
  if (value.startsWith("MONOREPO_")) return "node:22-bookworm";
  if (value.startsWith("JAVA_MAVEN_")) {
    const version = Number(value.match(/JAVA_MAVEN_(\d+)/)?.[1] ?? 8);
    return version <= 8
      ? "maven:3.8.8-eclipse-temurin-8"
      : `maven:3.9.9-eclipse-temurin-${version}`;
  }
  if (value.startsWith("JAVA_GRADLE")) return "gradle:8.10-jdk17";
  if (/^DOTNET_\d+$/.test(value)) return `mcr.microsoft.com/dotnet/sdk:${value.slice("DOTNET_".length)}.0`;
  if (value === "PHP") return "composer:2";
  if (value === "STATIC") return "python:3.12-bookworm";
  return "node:22-bookworm";
}

export function normalizeValidationConfiguration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Configuração da validação inválida");
  }

  const runtime = String(input.runtime || "NODE").trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,80}$/.test(runtime)) throw new Error("Runtime da validação inválido");

  const workingDirectory = String(input.workingDirectory || ".").trim().replaceAll("\\", "/");
  if (!workingDirectory || workingDirectory.length > 300 || path.isAbsolute(workingDirectory) || workingDirectory.split("/").includes("..")) {
    throw new Error("Diretório de trabalho da validação inválido");
  }

  if (!Array.isArray(input.commands) || input.commands.length < 1 || input.commands.length > 4) {
    throw new Error("A validação deve possuir entre 1 e 4 comandos");
  }

  const seenScopes = new Set();
  const commands = input.commands.map((entry) => {
    const scope = String(entry?.scope || "").trim().toLowerCase();
    const command = String(entry?.command || "").trim();
    if (!VALIDATION_SCOPES.has(scope)) throw new Error(`Escopo de validação inválido: ${scope || "ausente"}`);
    if (seenScopes.has(scope)) throw new Error(`Escopo de validação duplicado: ${scope}`);
    if (!command || command.length > 4_000 || /[\0]/.test(command)) throw new Error(`Comando de ${scope} inválido`);
    seenScopes.add(scope);
    return {
      scope,
      command,
      timeoutMs: integer(entry?.timeoutMs, 10 * 60_000, 1_000, 30 * 60_000, `Timeout de ${scope}`),
    };
  });

  return {
    runtime,
    image: validationRuntimeImage(runtime),
    workingDirectory,
    commands,
    memoryMb: integer(input.memoryMb, 1_024, 256, 4_096, "Memória da validação"),
    workspaceMb: integer(input.workspaceMb, 2_048, 512, 8_192, "Workspace da validação"),
    cpuLimit: number(input.cpuLimit, 1, 0.25, 4, "CPU da validação"),
    pidsLimit: integer(input.pidsLimit, 256, 64, 1_024, "Limite de processos"),
    networkMode: input.networkMode === "none" ? "none" : "bridge",
    stripComponents: integer(input.stripComponents, 0, 0, 1, "stripComponents"),
  };
}

function runtimeCommand(runtime, command) {
  if (runtime.startsWith("PYTHON_")) {
    return [
      "if [ ! -x /workspace/.dashboardia-venv/bin/python ]; then python3 -m venv /workspace/.dashboardia-venv; fi",
      "export VIRTUAL_ENV=/workspace/.dashboardia-venv",
      "export PATH=\"$VIRTUAL_ENV/bin:$PATH\"",
      command,
    ].join("; ");
  }
  return command;
}

export function validationContainerCreateArguments(id, configuration) {
  const containerName = validationContainerName(id);
  return [
    "create",
    "--name", containerName,
    "--init",
    "--stop-timeout", "5",
    "--read-only",
    "--network", configuration.networkMode,
    "--memory", `${configuration.memoryMb}m`,
    "--memory-swap", `${configuration.memoryMb}m`,
    "--cpus", String(configuration.cpuLimit),
    "--pids-limit", String(configuration.pidsLimit),
    "--ulimit", "nofile=1024:1024",
    "--ulimit", `nproc=${configuration.pidsLimit}:${configuration.pidsLimit}`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777",
    "--tmpfs", `/workspace:rw,exec,nosuid,nodev,size=${configuration.workspaceMb}m,mode=1777`,
    "--user", "1000:1000",
    "--env", "HOME=/workspace/.dashboardia-home",
    "--env", "CI=true",
    "--env", "NO_COLOR=1",
    "--env", "FORCE_COLOR=0",
    "--env", "NPM_CONFIG_CACHE=/workspace/.dashboardia-home/.npm",
    "--env", "PIP_CACHE_DIR=/workspace/.dashboardia-home/.cache/pip",
    "--env", "MAVEN_CONFIG=/workspace/.dashboardia-home/.m2",
    "--env", "GRADLE_USER_HOME=/workspace/.dashboardia-home/.gradle",
    "--env", "DOTNET_CLI_HOME=/workspace/.dashboardia-home/.dotnet",
    "--env", "COMPOSER_CACHE_DIR=/workspace/.dashboardia-home/.composer",
    "--label", `dashboardia.validation.id=${id}`,
    "--entrypoint", "/bin/sh",
    configuration.image,
    "-lc",
    "mkdir -p /workspace/.dashboardia-home; while :; do sleep 3600; done",
  ];
}

export function validationContainerExecArguments(id, configuration, command) {
  const workingDirectory = configuration.workingDirectory === "."
    ? "/workspace"
    : `/workspace/${configuration.workingDirectory}`;
  return [
    "exec",
    "--user", "1000:1000",
    "--workdir", workingDirectory,
    "--env", `NODE_OPTIONS=--max-old-space-size=${Math.max(128, configuration.memoryMb - 128)}`,
    validationContainerName(id),
    "/bin/sh",
    "-lc",
    runtimeCommand(configuration.runtime, command.command),
  ];
}

export function validationStateIsTerminal(status) {
  return TERMINAL_STATUSES.has(String(status || ""));
}
