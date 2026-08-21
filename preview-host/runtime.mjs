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

export function railpackPrepareArguments({ sourceDirectory, planFile, infoFile }) {
  return [
    "prepare",
    "--plan-out", planFile,
    "--info-out", infoFile,
    sourceDirectory,
  ];
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
  const forwardedProto = String(headers["x-forwarded-proto"] || "https").split(",")[0].trim().toLowerCase();
  const publicProto = ["http", "https"].includes(forwardedProto) ? forwardedProto : "https";
  return {
    ...headers,
    ...(originalHost ? {
      "x-forwarded-host": originalHost,
      "x-forwarded-proto": publicProto,
      "x-forwarded-port": publicProto === "https" ? "443" : "80",
    } : {}),
    // Vite 4 valida o Host antes de servir a aplicação. Endereços IP são
    // aceitos por padrão, enquanto aliases Docker e, em algumas versões,
    // localhost recebido por proxy podem resultar em HTTP 403.
    host: `127.0.0.1:${port}`,
  };
}

export function isOpenApiDocumentPath(requestUrl = "/") {
  const pathname = new URL(requestUrl, "http://preview.internal").pathname;
  return /(?:^|\/)(?:v[23]\/api-docs|api-docs|openapi(?:\.json)?|swagger(?:\.json)?)(?:\/|$)/i.test(pathname);
}

function isLocalPreviewHostname(hostname) {
  return ["127.0.0.1", "0.0.0.0", "localhost", "::1"].includes(String(hostname || "").toLowerCase());
}

function rewriteLocalPreviewUrl(value, publicOrigin) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    if (!isLocalPreviewHostname(url.hostname)) return value;
    const publicUrl = new URL(publicOrigin);
    return `${publicUrl.origin}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

export function rewriteOpenApiDocument(source, publicOrigin) {
  let document;
  try {
    document = JSON.parse(String(source || ""));
    new URL(publicOrigin);
  } catch {
    return String(source || "");
  }

  if (Array.isArray(document.servers)) {
    document.servers = document.servers.map((server) => (
      server && typeof server === "object"
        ? { ...server, url: rewriteLocalPreviewUrl(server.url, publicOrigin) }
        : server
    ));
  }
  if (typeof document.url === "string") document.url = rewriteLocalPreviewUrl(document.url, publicOrigin);
  if (Array.isArray(document.urls)) {
    document.urls = document.urls.map((entry) => (
      entry && typeof entry === "object"
        ? { ...entry, url: rewriteLocalPreviewUrl(entry.url, publicOrigin) }
        : entry
    ));
  }
  if (typeof document.host === "string" && isLocalPreviewHostname(document.host.split(":")[0])) {
    const publicUrl = new URL(publicOrigin);
    document.host = publicUrl.host;
    document.schemes = [publicUrl.protocol.slice(0, -1)];
  }
  return JSON.stringify(document);
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

function phpCommandInRepository(command, workingDirectory = ".") {
  const configured = String(command || "").trim();
  if (!configured || /^\(cd\s+.+?\s+&&\s+.+\)$/s.test(configured)) return configured;
  const composerCommand = /(?:^|[;&|\s])composer(?:\s|$)/i.test(configured);
  const entryLookup = composerCommand
    ? 'find . -type f -name composer.json -not -path "*/vendor/*"'
    : 'find . -type f \\( -name composer.json -o -name index.php \\) -not -path "*/vendor/*"';
  const localEntryCheck = composerCommand
    ? '[ ! -f "$project_dir/composer.json" ]'
    : '[ ! -f "$project_dir/composer.json" ] && [ ! -f "$project_dir/index.php" ] && [ ! -f "$project_dir/public/index.php" ]';
  const missingEntryAction = composerCommand
    ? 'echo "Composer ignorado: a branch não possui composer.json"; exit 0'
    : 'echo "Não foi possível localizar a entrada PHP da aplicação" >&2; exit 1';
  return [
    `project_dir=${shellQuote(workingDirectory || ".")}`,
    `if ${localEntryCheck}; then entry="$(${entryLookup} -printf '%d %p\\n' | sort -n | head -n 1 | cut -d' ' -f2-)"; if [ -z "$entry" ]; then ${missingEntryAction}; fi; project_dir="$(dirname "$entry")"; fi`,
    'cd "$project_dir"',
    configured,
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
  const mavenWar = /^(?:\(cd\s+.+?\s+&&\s+)?__MAVEN_WAR__(?:\))?$/i.test(String(configuration.previewCommand || "").trim());
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
  if (runtime.startsWith("JAVA_MAVEN") && (staticHttpServer || mavenWar)) {
    return buildMavenWarDockerfile(configuration);
  }

  const lines = needsMaven
    ? [
        "FROM node:22-bookworm AS node-toolchain",
        `FROM ${mavenImage(javaVersionFromRuntime(runtime))}`,
        "COPY --from=node-toolchain /usr/local /usr/local",
      ]
    : runtime === "PHP"
      ? [
          "FROM composer:2 AS composer-toolchain",
          `FROM ${runtimeImage(runtime)}`,
          "COPY --from=composer-toolchain /usr/bin/composer /usr/local/bin/composer",
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
  const scopedInstallCommand = runtime === "PHP" ? phpCommandInRepository(configuration.installCommand, configuration.workingDirectory) : configuration.installCommand;
  const scopedBuildCommand = runtime === "PHP" ? phpCommandInRepository(configuration.buildCommand, configuration.workingDirectory) : configuration.buildCommand;
  const installCommand = needsPython ? withPythonVirtualEnvironment(scopedInstallCommand) : scopedInstallCommand;
  const buildCommand = needsPython ? withPythonVirtualEnvironment(scopedBuildCommand) : scopedBuildCommand;
  const normalizedPrimaryCommand = normalizePreviewCommand(configuration.previewCommand);
  const scopedPrimaryCommand = runtime === "PHP" ? phpCommandInRepository(normalizedPrimaryCommand, configuration.workingDirectory) : normalizedPrimaryCommand;
  const combinedCommand = combinedPreviewCommand(scopedPrimaryCommand, configuration.auxiliaryPreviewCommand, configuration.auxiliaryPreviewPort);
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
