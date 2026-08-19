import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildPreviewDockerfile,
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

test("restringe identificadores usados em nomes do Docker", () => {
  assert.equal(validPreviewId("cm1234567890"), true);
  assert.equal(validPreviewId("../../root"), false);
  assert.throws(() => previewContainerName("bad id"));
  assert.equal(previewNetworkName("cm1234567890"), "dashboardia-preview-cm1234567890");
});
