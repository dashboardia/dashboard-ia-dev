const RUNTIME_IMAGES = {
  NODE: "node:22-bookworm-slim",
  JAVA_MAVEN: "maven:3.9.9-eclipse-temurin-17",
  JAVA_GRADLE: "gradle:8.10-jdk17",
  PHP: "php:8.3-cli",
  STATIC: "python:3.12-slim",
};

export function validPreviewId(value) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(String(value || ""));
}

export function previewContainerName(id) {
  if (!validPreviewId(id)) throw new Error("Identificador de preview inválido");
  return `dashboardia-preview-${id}`;
}

export function previewImageName(id) {
  if (!validPreviewId(id)) throw new Error("Identificador de preview inválido");
  return `dashboardia-preview:${id}`;
}

export function previewNetworkName(id) {
  if (!validPreviewId(id)) throw new Error("Identificador de preview inválido");
  return `dashboardia-preview-${id}`;
}

function runtimeImage(runtime) {
  if (runtime?.startsWith("PYTHON_")) return "python:3.12-slim";
  if (runtime?.startsWith("MONOREPO_")) return "node:22-bookworm";
  return RUNTIME_IMAGES[runtime] || RUNTIME_IMAGES.NODE;
}

function shellInstruction(kind, command) {
  return command?.trim()
    ? `${kind} ${JSON.stringify(["/bin/sh", "-lc", String(command)])}`
    : null;
}

function normalizePreviewCommand(command) {
  return String(command)
    .replaceAll("127.0.0.1", "0.0.0.0")
    .replaceAll("localhost", "0.0.0.0");
}

function isStaticHttpServer(command) {
  return /^python3?\s+-m\s+http\.server(?:\s|$)/i.test(String(command || "").trim());
}

export function buildPreviewDockerfile(configuration) {
  const runtime = String(configuration.runtime || "UNKNOWN");
  const staticHttpServer = isStaticHttpServer(configuration.previewCommand);
  const lines = [`FROM ${runtimeImage(staticHttpServer ? "STATIC" : runtime)}`];
  if (runtime.startsWith("MONOREPO_")) {
    lines.push("RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*");
  }
  lines.push("WORKDIR /app", "COPY . .");
  // Um servidor HTTP estático não depende da stack principal do repositório.
  // Não execute comandos legados/incompatíveis (por exemplo npm em uma imagem
  // Maven) quando o cliente escolheu publicar diretamente os arquivos HTML.
  const install = shellInstruction("RUN", staticHttpServer ? null : configuration.installCommand);
  const build = shellInstruction("RUN", staticHttpServer ? null : configuration.buildCommand);
  if (install) lines.push(install);
  if (build) lines.push(build);
  lines.push(
    `ENV PORT=${configuration.port}`,
    "ENV HOST=0.0.0.0",
    "ENV HOSTNAME=0.0.0.0",
    `EXPOSE ${configuration.port}`,
    shellInstruction("CMD", normalizePreviewCommand(configuration.previewCommand)),
  );
  return `${lines.join("\n")}\n`;
}
