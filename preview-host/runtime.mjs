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

export function probePreviewHttp(hostname, port, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname,
      port,
      path: "/",
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
  const entrypoint = configuration.workingDirectory && configuration.workingDirectory !== "."
    ? `${configuration.workingDirectory}/index.html`
    : "index.html";

  return [
    "FROM maven:3.8.8-eclipse-temurin-8 AS build",
    "WORKDIR /app",
    "COPY . .",
    shellInstruction("RUN", buildCommand),
    shellInstruction(
      "RUN",
      'war="$(find . -type f -path "*/target/*.war" ! -name "*sources*" ! -name "*javadoc*" | head -n 1)"; test -n "$war"; cp "$war" /tmp/ROOT.war',
    ),
    // Alguns legados mantêm o index.html de demonstração na raiz do
    // repositório, fora de src/main/webapp. Ele continua sendo apenas a porta
    // de entrada: controllers, JSPs e endpoints seguem executando no Tomcat.
    shellInstruction(
      "RUN",
      `mkdir -p /tmp/dashboardia-entrypoint; entrypoint=${shellQuote(entrypoint)}; if [ -f "$entrypoint" ]; then cp "$entrypoint" /tmp/dashboardia-entrypoint/index.html; fi`,
    ),
    "",
    "FROM tomcat:9.0-jdk8-temurin",
    "RUN rm -rf /usr/local/tomcat/webapps/*",
    `RUN sed -i 's/port="8080" protocol="HTTP\\/1.1"/port="${port}" protocol="HTTP\\/1.1"/' /usr/local/tomcat/conf/server.xml`,
    "COPY --from=build /tmp/ROOT.war /tmp/ROOT.war",
    "COPY --from=build /tmp/dashboardia-entrypoint/ /tmp/dashboardia-entrypoint/",
    shellInstruction(
      "RUN",
      'root=/usr/local/tomcat/webapps/ROOT; mkdir -p "$root"; cd "$root"; jar -xf /tmp/ROOT.war; rm /tmp/ROOT.war; if [ ! -f "$root/index.html" ] && [ ! -f "$root/index.htm" ] && [ ! -f "$root/index.jsp" ] && [ -f /tmp/dashboardia-entrypoint/index.html ]; then cp /tmp/dashboardia-entrypoint/index.html "$root/index.html"; mkdir -p "$root/src/main"; ln -sfn ../.. "$root/src/main/webapp"; fi; rm -rf /tmp/dashboardia-entrypoint',
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
  const pythonMonorepo = runtime.startsWith("MONOREPO_");

  // Projetos Maven empacotados como WAR precisam executar a aplicação inteira.
  // Um comando HTTP estático configurado anteriormente é apenas um fallback de
  // captura visual e não deve esconder controllers, services, JSPs ou o banco
  // embarcado da aplicação durante a revisão do cliente.
  if (runtime === "JAVA_MAVEN" && staticHttpServer) {
    return buildMavenWarDockerfile(configuration);
  }

  const lines = [`FROM ${runtimeImage(staticHttpServer ? "STATIC" : runtime)}`];
  if (pythonMonorepo) {
    lines.push("RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*");
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
  const installCommand = pythonMonorepo ? withPythonVirtualEnvironment(configuration.installCommand) : configuration.installCommand;
  const buildCommand = pythonMonorepo ? withPythonVirtualEnvironment(configuration.buildCommand) : configuration.buildCommand;
  const previewCommand = pythonMonorepo ? withPythonVirtualEnvironment(normalizePreviewCommand(configuration.previewCommand)) : normalizePreviewCommand(configuration.previewCommand);
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
