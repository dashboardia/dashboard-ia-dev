import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildPreviewDockerfile,
  isTransientDockerError,
  isPreviewReadyStatus,
  previewContainerName,
  previewNetworkName,
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
  assert.match(result, /dashboardia-entrypoint/);
  assert.match(result, /if \[ ! -f/);
  assert.match(result, /cp \/tmp\/dashboardia-entrypoint\/index\.html/);
  assert.match(result, /ln -sfn \.\.\/\.\./);
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
