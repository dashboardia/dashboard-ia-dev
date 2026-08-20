import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { prepareDemoAccess } from "./demo-access.mjs";

test("configura credenciais e seed reconhecidos sem alterar os arquivos", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  const file = path.join(root, "backend/config.py");
  await mkdir(path.dirname(file), { recursive: true });
  const source = 'ADMIN_USER = os.getenv("ADMIN_USER")\nADMIN_PASS = os.getenv("ADMIN_PASS")\nSEED_DEMO_DATA = True';
  await writeFile(file, source);
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.deepEqual(result.environment, { ADMIN_USER: "demo", ADMIN_PASS: "Safe-123", SEED_DEMO_DATA: "true" });
    assert.deepEqual(result.credentials, { username: "demo", email: null, password: "Safe-123" });
    assert.equal(result.adjustments[0].code, "TEMPORARY_DEMO_ACCESS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("não anuncia credenciais quando o projeto não oferece configuração compatível", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  await writeFile(path.join(root, "app.py"), "print('sem autenticação configurável')");
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.deepEqual(result, { environment: {}, credentials: null, adjustments: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
