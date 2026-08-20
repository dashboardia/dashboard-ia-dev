import http from "node:http";

const RUNTIME_IMAGES = {
  NODE: "node:22-bookworm-slim",
  JAVA_MAVEN: "maven:3.8.8-eclipse-temurin-8",
  JAVA_GRADLE: "gradle:8.10-jdk17",
  PHP: "php:8.3-cli",
  STATIC: "python:3.12-slim",
};

const TRANSIENT_DOCKER_ERRORS = [
  /temporary failure in name resolution/i,
  /tls handshake timeout/i,
  /i\/o timeout/i,
  /connection reset by peer/i,
  /connection refused/i,
  /unexpected eof/i,
  /too many requests/i,
  /toomanyrequests/i,
  /service unavailable/i,
];

export function isTransientDockerError(error) {
  const output = typeof error === "string"
    ? error
    : [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
  return TRANSIENT_DOCKER_ERRORS.some((pattern) => pattern.test(output));
}

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

export function isPreviewReadyStatus(status) {
  return Number(status) >= 200 && Number(status) < 400;
}

export function previewUpstreamHeaders(headers = {}, port) {
  const originalHost = headers.host;
  return {
    ...headers,
    ...(originalHost ? { "x-forwarded-host": originalHost } : {}),
    // Vite 4 valida o Host antes de servir a aplicação. Endereços IP são
    // aceitos por padrão, enquanto aliases Docker e, em algumas versões,
    // localhost recebido por proxy podem resultar em HTTP 403.
    host: `127.0.0.1:${port}`,
  };
}

export function probePreviewHttp(hostname, port, requestPath = "/", timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname,
      port,
      path: requestPath,
      method: "GET",
      headers: previewUpstreamHeaders({}, port),
    }, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Timeout ao verificar o preview")));
    request.on("error", reject);
    request.end();
  });
}

export function previewUpstreamPath(requestUrl, entryPath = "/") {
  const url = new URL(requestUrl || "/", "http://preview.internal");
  if (url.pathname !== "/" || entryPath === "/") return requestUrl || "/";
  return `${entryPath}${url.search}`;
}

function runtimeImage(runtime) {
  if (runtime?.startsWith("PYTHON_")) return "python:3.12-slim";
  if (runtime?.startsWith("MONOREPO_")) return "node:22-bookworm";
  if (runtime?.startsWith("JAVA_MAVEN_")) return mavenImage(javaVersionFromRuntime(runtime));
  if (/^DOTNET_\d+$/.test(runtime)) return `mcr.microsoft.com/dotnet/sdk:${runtime.slice("DOTNET_".length)}.0`;
  return RUNTIME_IMAGES[runtime] || RUNTIME_IMAGES.NODE;
}

function javaVersionFromRuntime(runtime) {
  const declared = Number(String(runtime || "").match(/JAVA_MAVEN_(\d+)/)?.[1] ?? 8);
  return String(Number.isInteger(declared) ? Math.max(8, declared) : 8);
}

function mavenImage(javaVersion) {
  return String(javaVersion) === "8"
    ? "maven:3.8.8-eclipse-temurin-8"
    : `maven:3.9.9-eclipse-temurin-${javaVersion}`;
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

function combinedPreviewCommand(primaryCommand, auxiliaryCommand, auxiliaryPort) {
  if (!auxiliaryCommand?.trim()) return primaryCommand;
  const auxiliary = normalizePreviewCommand(auxiliaryCommand).replaceAll("$PORT", String(auxiliaryPort));
  return `(${auxiliary}) & auxiliary_pid=$!; trap 'kill $auxiliary_pid 2>/dev/null || true' EXIT INT TERM; ${primaryCommand}`;
}

function withPythonVirtualEnvironment(command) {
  if (!command?.trim()) return command;
  return `export VIRTUAL_ENV=/opt/dashboardia-venv; export PATH="$VIRTUAL_ENV/bin:$PATH"; ${command}`;
}

function isStaticHttpServer(command) {
  return /^(?:\(cd\s+[^&]+\s+&&\s+)?python3?\s+-m\s+http\.server(?:\s|$)/i.test(String(command || "").trim());
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function mavenBuildCommandInRepository(command, workingDirectory = ".") {
  const configured = String(command || "mvn -B -DskipTests package").trim();
  const scoped = configured.match(/^\(cd\s+.+?\s+&&\s+((?:\.\/)?mvn(?:w)?\s+.+)\)$/s);
  const invocation = scoped?.[1] ?? configured;
  if (!/^(?:\.\/)?mvn(?:w)?(?:\s|$)/.test(invocation) || /(?:^|\s)(?:-f|--file)(?:\s|=)/.test(invocation)) return configured;
  return [
    `project_dir=${shellQuote(workingDirectory || ".")}`,
    'if [ ! -f "$project_dir/pom.xml" ]; then pom="$(find . -type f -name pom.xml -not -path "*/target/*" -printf \'%d %p\\n\' | sort -n | head -n 1 | cut -d\' \' -f2-)"; project_dir="$(dirname "$pom")"; fi',
    'test -f "$project_dir/pom.xml"',
    'cd "$project_dir"',
    invocation,
  ].join("; ");
}

function buildMavenWarDockerfile(configuration) {
  const port = Number(configuration.port) || 8080;
  const buildCommand = mavenBuildCommandInRepository(configuration.buildCommand, configuration.workingDirectory);
  const javaVersion = javaVersionFromRuntime(configuration.runtime);

  return [
    `FROM ${mavenImage(javaVersion)} AS build`,
    "WORKDIR /app",
    "COPY . .",
    shellInstruction("RUN", buildCommand),
    shellInstruction(
      "RUN",
      'war="$(find . -type f -path "*/target/*.war" ! -name "*sources*" ! -name "*javadoc*" | head -n 1)"; test -n "$war"; cp "$war" /tmp/ROOT.war',
    ),
    "",
    `FROM tomcat:9.0-jdk${javaVersion}-temurin`,
    "RUN rm -rf /usr/local/tomcat/webapps/*",
    `RUN sed -i 's/port="8080" protocol="HTTP\\/1.1"/port="${port}" protocol="HTTP\\/1.1"/' /usr/local/tomcat/conf/server.xml`,
    "COPY --from=build /tmp/ROOT.war /tmp/ROOT.war",
    shellInstruction(
      "RUN",
      'root=/usr/local/tomcat/webapps/ROOT; mkdir -p "$root"; cd "$root"; jar -xf /tmp/ROOT.war; rm /tmp/ROOT.war',
    ),
    'ENV JAVA_OPTS="-Djava.awt.headless=true"',
    `ENV PORT=${port}`,
    "ENV HOST=0.0.0.0",
    "ENV HOSTNAME=0.0.0.0",
    `EXPOSE ${port}`,
    'CMD ["catalina.sh","run"]',
    "",
  ].join("\n");
}

export function buildPreviewDockerfile(configuration) {
  const runtime = String(configuration.runtime || "UNKNOWN");
  const staticHttpServer = isStaticHttpServer(configuration.previewCommand);
  const monorepo = runtime.startsWith("MONOREPO_");
  const configuredCommands = [
    configuration.installCommand,
    configuration.buildCommand,
    configuration.previewCommand,
    configuration.auxiliaryPreviewCommand,
  ].filter(Boolean).join("\n");
  const needsPython = monorepo && (
    runtime.includes("PYTHON_")
    || /(?:^|[;&|\s])(?:python3?|pip3?|uvicorn|flask)(?:\s|$)/i.test(configuredCommands)
  );
  const needsMaven = monorepo && (
    runtime.includes("JAVA_MAVEN")
    || /(?:^|[;&|\s])(?:\.\/)?mvn(?:w)?(?:\s|$)/i.test(configuredCommands)
  );

  // Projetos Maven empacotados como WAR precisam executar a aplicação inteira.
  // Um comando HTTP estático configurado anteriormente é apenas um fallback de
  // captura visual e não deve esconder controllers, services, JSPs ou o banco
  // embarcado da aplicação durante a revisão do cliente.
  if (runtime.startsWith("JAVA_MAVEN") && staticHttpServer) {
    return buildMavenWarDockerfile(configuration);
  }

  const lines = needsMaven
    ? [
        "FROM node:22-bookworm AS node-toolchain",
        `FROM ${mavenImage(javaVersionFromRuntime(runtime))}`,
        "COPY --from=node-toolchain /usr/local /usr/local",
      ]
    : [`FROM ${runtimeImage(staticHttpServer ? "STATIC" : runtime)}`];
  const systemPackages = [
    ...(needsPython ? ["python3", "python3-pip", "python3-venv"] : []),
  ];
  if (systemPackages.length) {
    lines.push(`RUN apt-get update && apt-get install -y --no-install-recommends ${systemPackages.join(" ")} && rm -rf /var/lib/apt/lists/*`);
  }
  if (needsPython) {
    lines.push(
      "RUN python3 -m venv /opt/dashboardia-venv",
      "ENV VIRTUAL_ENV=/opt/dashboardia-venv",
      'ENV PATH="/opt/dashboardia-venv/bin:$PATH"',
    );
  }
  lines.push("WORKDIR /app", "COPY . .");
  // Um servidor HTTP estático não depende da stack principal do repositório.
  // Não execute comandos legados/incompatíveis (por exemplo npm em uma imagem
  // Maven) quando o cliente escolheu publicar diretamente os arquivos HTML.
  const installCommand = needsPython ? withPythonVirtualEnvironment(configuration.installCommand) : configuration.installCommand;
  const buildCommand = needsPython ? withPythonVirtualEnvironment(configuration.buildCommand) : configuration.buildCommand;
  const normalizedPrimaryCommand = normalizePreviewCommand(configuration.previewCommand);
  const combinedCommand = combinedPreviewCommand(normalizedPrimaryCommand, configuration.auxiliaryPreviewCommand, configuration.auxiliaryPreviewPort);
  const previewCommand = needsPython ? withPythonVirtualEnvironment(combinedCommand) : combinedCommand;
  const install = shellInstruction("RUN", staticHttpServer ? null : installCommand);
  const build = shellInstruction("RUN", staticHttpServer ? null : buildCommand);
  if (install) lines.push(install);
  if (build) lines.push(build);
  lines.push(
    `ENV PORT=${configuration.port}`,
    "ENV HOST=0.0.0.0",
    "ENV HOSTNAME=0.0.0.0",
    `EXPOSE ${configuration.port}`,
    shellInstruction("CMD", previewCommand),
  );
  return `${lines.join("\n")}\n`;
}
