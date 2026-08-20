import assert from "node:assert/strict";
import http from "node:http";
import { test } from "vitest";
import {
  buildPreviewDockerfile,
  isTransientDockerError,
  isOpenApiDocumentPath,
  isPreviewReadyStatus,
  probePreviewHttp,
  previewUpstreamHeaders,
  previewUpstreamPath,
  previewContainerName,
  previewNetworkName,
  rewriteOpenApiDocument,
  validPreviewId,
} from "./runtime.mjs";

test("gera Dockerfile Node que publica em todas as interfaces", () => {
  const result = buildPreviewDockerfile({
    runtime: "NODE",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    previewCommand: "npm start -- --hostname localhost",
    port: 3000,
  });
  assert.match(result, /^FROM node:22-bookworm-slim/m);
  assert.match(result, /ENV HOSTNAME=0\.0\.0\.0/);
  assert.match(result, /npm start -- --hostname 0\.0\.0\.0/);
});

test("gera ambiente ASP.NET Core com a versão detectada do SDK", () => {
  const result = buildPreviewDockerfile({
    runtime: "DOTNET_8",
    installCommand: "dotnet restore",
    buildCommand: "dotnet build -c Release --no-restore",
    previewCommand: "dotnet run -c Release --no-build --no-launch-profile --urls http://127.0.0.1:$PORT",
    port: 8080,
  });

  assert.match(result, /^FROM mcr\.microsoft\.com\/dotnet\/sdk:8\.0/m);
  assert.match(result, /dotnet restore/);
  assert.match(result, /dotnet build -c Release --no-restore/);
  assert.match(result, /dotnet run -c Release --no-build/);
  assert.match(result, /http:\/\/0\.0\.0\.0:\$PORT/);
  assert.match(result, /EXPOSE 8080/);
});

test("instala dependências Python do monorepo em ambiente virtual", () => {
  const result = buildPreviewDockerfile({
    runtime: "MONOREPO_PYTHON_FASTAPI_NODE",
    installCommand: "(cd backend && pip install -r requirements.txt) && npm --prefix frontend ci",
    buildCommand: "npm --prefix frontend run build",
    previewCommand: "npm --prefix frontend run dev -- --host 127.0.0.1 --port $PORT",
    auxiliaryPreviewCommand: "(cd backend && uvicorn main:app --host 127.0.0.1 --port $PORT)",
    auxiliaryPreviewPort: 8000,
    port: 5173,
  });

  assert.match(result, /^FROM node:22-bookworm/m);
  assert.match(result, /python3 -m venv \/opt\/dashboardia-venv/);
  assert.match(result, /ENV VIRTUAL_ENV=\/opt\/dashboardia-venv/);
  assert.match(result, /ENV PATH="\/opt\/dashboardia-venv\/bin:\$PATH"/);
  assert.match(result, /export VIRTUAL_ENV=\/opt\/dashboardia-venv; export PATH=\\"\$VIRTUAL_ENV\/bin:\$PATH\\"; \(cd backend && pip install/);
  assert.match(result, /pip install -r requirements\.txt/);
  assert.match(result, /uvicorn main:app --host 0\.0\.0\.0 --port 8000/);
  assert.match(result, /auxiliary_pid=\$!/);
  assert.match(result, /npm --prefix frontend run dev/);
});

test("instala Maven e JDK no monorepo Java com frontend Node", () => {
  const result = buildPreviewDockerfile({
    runtime: "MONOREPO_JAVA_MAVEN_NODE",
    installCommand: "npm --prefix frontend ci",
    buildCommand: "mvn -B -DskipTests package && npm --prefix frontend run build",
    previewCommand: "npm --prefix frontend run dev -- --host 127.0.0.1 --port $PORT",
    auxiliaryPreviewCommand: "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=$PORT",
    auxiliaryPreviewPort: 8080,
    port: 5173,
  });

  assert.match(result, /^FROM node:22-bookworm AS node-toolchain/m);
  assert.match(result, /^FROM maven:3\.8\.8-eclipse-temurin-8/m);
  assert.match(result, /COPY --from=node-toolchain \/usr\/local \/usr\/local/);
  assert.doesNotMatch(result, /python3|dashboardia-venv/);
  assert.match(result, /mvn -B -DskipTests package/);
  assert.match(result, /npm --prefix frontend run build/);
  assert.match(result, /mvn spring-boot:run/);
  assert.match(result, /auxiliary_pid=\$!/);
});

test("usa Maven e runtime compatíveis com Java 21", () => {
  const result = buildPreviewDockerfile({
    runtime: "JAVA_MAVEN_21",
    buildCommand: "mvn -B -DskipTests package",
    previewCommand: "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=$PORT",
    port: 8080,
  });

  assert.match(result, /^FROM maven:3\.9\.9-eclipse-temurin-21/m);
  assert.match(result, /mvn -B -DskipTests package/);
  assert.match(result, /mvn spring-boot:run/);
});

test("protege ambientes persistidos com Java 7 usando a imagem compatível do JDK 8", () => {
  const result = buildPreviewDockerfile({
    runtime: "JAVA_MAVEN_7",
    buildCommand: "mvn -B -DskipTests package",
    previewCommand: "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=$PORT",
    port: 8080,
  });

  assert.match(result, /^FROM maven:3\.8\.8-eclipse-temurin-8/m);
  assert.doesNotMatch(result, /eclipse-temurin-7|jdk7-temurin/);
});

test("mantém comandos não confiáveis dentro do JSON da instrução", () => {
  const result = buildPreviewDockerfile({
    runtime: "NODE",
    installCommand: "npm ci\nFROM alpine",
    buildCommand: null,
    previewCommand: "npm start",
    port: 3000,
  });
  assert.equal(result.match(/^FROM /gm)?.length, 1);
  assert.match(result, /npm ci\\nFROM alpine/);
});

test("compila e publica o WAR completo quando um projeto Maven tinha fallback estático", () => {
  const result = buildPreviewDockerfile({
    runtime: "JAVA_MAVEN",
    installCommand: "npm ci",
    buildCommand: "mvn -B -DskipTests package",
    previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1",
    port: 3000,
  });

  assert.match(result, /^FROM maven:3\.8\.8-eclipse-temurin-8 AS build/m);
  assert.match(result, /^FROM tomcat:9\.0-jdk8-temurin/m);
  assert.doesNotMatch(result, /npm ci/);
  assert.match(result, /mvn -B -DskipTests package/);
  assert.match(result, /target\/\*\.war/);
  assert.match(result, /ROOT\.war/);
  assert.match(result, /jar -xf \/tmp\/ROOT\.war/);
  assert.doesNotMatch(result, /dashboardia-entrypoint/);
  assert.doesNotMatch(result, /index\.html/);
  assert.match(result, /port="3000"/);
  assert.match(result, /CMD \["catalina\.sh","run"\]/);
  assert.doesNotMatch(result, /python3 -m http\.server/);
});

test("compila Maven no diretório detectado sem perder a publicação do WAR", () => {
  const result = buildPreviewDockerfile({
    runtime: "JAVA_MAVEN",
    workingDirectory: "sistema-web",
    buildCommand: "(cd sistema-web && mvn -B -DskipTests package)",
    previewCommand: "(cd sistema-web && python3 -m http.server $PORT --bind 127.0.0.1)",
    port: 8080,
  });

  assert.match(result, /project_dir='sistema-web'/);
  assert.match(result, /find \. -type f -name pom\.xml/);
  assert.match(result, /mvn -B -DskipTests package/);
  assert.match(result, /^FROM tomcat:9\.0-jdk8-temurin/m);
  assert.match(result, /find \. -type f -path/);
  assert.doesNotMatch(result, /entrypoint=/);
});

test("o próprio Dockerfile localiza um pom aninhado quando recebe Maven na raiz", () => {
  const result = buildPreviewDockerfile({
    runtime: "JAVA_MAVEN",
    workingDirectory: ".",
    buildCommand: "mvn -B -DskipTests package",
    previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1",
    port: 8080,
  });

  assert.match(result, /find \. -type f -name pom\.xml/);
  assert.match(result, /cd \\"\$project_dir\\"/);
  assert.match(result, /mvn -B -DskipTests package/);
});

test("não considera 404 como preview pronto", () => {
  assert.equal(isPreviewReadyStatus(200), true);
  assert.equal(isPreviewReadyStatus(302), true);
  assert.equal(isPreviewReadyStatus(404), false);
  assert.equal(isPreviewReadyStatus(500), false);
});

test("usa IP local aceito pelo Vite no upstream sem perder o domínio público original", () => {
  assert.deepEqual(previewUpstreamHeaders({ host: "preview.example.com", accept: "text/html" }, 5173), {
    host: "127.0.0.1:5173",
    accept: "text/html",
    "x-forwarded-host": "preview.example.com",
    "x-forwarded-proto": "https",
    "x-forwarded-port": "443",
  });
});

test("reconhece documentos Swagger/OpenAPI sem confundir a interface HTML", () => {
  assert.equal(isOpenApiDocumentPath("/v3/api-docs"), true);
  assert.equal(isOpenApiDocumentPath("/v3/api-docs/swagger-config"), true);
  assert.equal(isOpenApiDocumentPath("/swagger.json"), true);
  assert.equal(isOpenApiDocumentPath("/swagger-ui/index.html"), false);
});

test("troca servidores locais do OpenAPI pelo domínio público do ambiente", () => {
  const result = JSON.parse(rewriteOpenApiDocument(JSON.stringify({
    openapi: "3.0.1",
    servers: [{ url: "http://127.0.0.1:8080/api" }],
    paths: { "/addresses": {} },
  }), "https://preview.example.com"));

  assert.equal(result.servers[0].url, "https://preview.example.com/api");
  assert.deepEqual(result.paths, { "/addresses": {} });
});

test("sonda uma rota do preview com o Host local aceito pelo Vite", async () => {
  const server = http.createServer((request, response) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    response.writeHead(request.headers.host === expectedHost && request.url === "/index.html" ? 204 : 403).end();
  });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const status = await probePreviewHttp("localhost", server.address().port, "/index.html");
    assert.equal(status, 204);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("direciona apenas a raiz pública para a entrada navegável detectada", () => {
  assert.equal(previewUpstreamPath("/", "/index.html"), "/index.html");
  assert.equal(previewUpstreamPath("/?cliente=1", "/index.html"), "/index.html?cliente=1");
  assert.equal(previewUpstreamPath("/src/main.jsx", "/index.html"), "/src/main.jsx");
  assert.equal(previewUpstreamPath("/", "/"), "/");
});

test("mantém servidor estático em repositório realmente estático", () => {
  const result = buildPreviewDockerfile({
    runtime: "STATIC",
    installCommand: null,
    buildCommand: null,
    previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1",
    port: 3000,
  });

  assert.match(result, /^FROM python:3\.12-slim/m);
  assert.match(result, /python3 -m http\.server \$PORT --bind 0\.0\.0\.0/);
});

test("restringe identificadores usados em nomes do Docker", () => {
  assert.equal(validPreviewId("cm1234567890"), true);
  assert.equal(validPreviewId("../../root"), false);
  assert.throws(() => previewContainerName("bad id"));
  assert.equal(previewNetworkName("cm1234567890"), "dashboardia-preview-cm1234567890");
});

test("reconhece falhas transitórias do registry para permitir nova tentativa", () => {
  assert.equal(isTransientDockerError('lookup auth.docker.io: Temporary failure in name resolution'), true);
  assert.equal(isTransientDockerError('failed to compile: package com.exemplo does not exist'), false);
});
