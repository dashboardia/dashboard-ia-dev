import assert from "node:assert/strict";
import { test } from "vitest";

import { buildPreviewDockerfile } from "./runtime.mjs";

test("instala os pacotes Node adicionais necessários antes de executar seed no ambiente", () => {
  const result = buildPreviewDockerfile({
    runtime: "NODE",
    installCommand: "npm --prefix client install",
    buildCommand: "npm --prefix client run build",
    previewCommand: "node server/index.js",
    demoSeedCommand: "npm run seed",
    port: 3000,
  });

  assert.match(result, /npm --prefix client install/);
  assert.match(result, /find \. -maxdepth 4 -type f -name package\.json/);
  assert.match(result, /node_modules/);
  assert.match(result, /npm ci.*npm install/s);
});

test("não adiciona a varredura de pacotes quando não existe seed demonstrativo", () => {
  const result = buildPreviewDockerfile({
    runtime: "NODE",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    previewCommand: "npm start",
    port: 3000,
  });

  assert.doesNotMatch(result, /find \. -maxdepth 4 -type f -name package\.json/);
});
