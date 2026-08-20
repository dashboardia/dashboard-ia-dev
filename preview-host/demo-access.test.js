import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    assert.deepEqual(result.credentials, {
      status: "READY",
      username: "demo",
      email: null,
      password: "Safe-123",
      message: "Acesso e massa de demonstração preparados automaticamente.",
      source: "Configuração do ambiente",
    });
    assert.equal(result.adjustments[0].code, "TEMPORARY_DEMO_ACCESS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ativa o contrato obrigatório de acesso demonstrativo do Dashboardia", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  const contract = path.join(root, ".dashboardia/demo-access.json");
  await mkdir(path.dirname(contract), { recursive: true });
  await writeFile(contract, JSON.stringify({
    version: 1,
    seedCommand: "java -jar tools/demo-seed.jar",
  }));
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.deepEqual(result.environment, {
      DASHBOARDIA_DEMO_MODE: "true",
      DASHBOARDIA_DEMO_USERNAME: "demo",
      DASHBOARDIA_DEMO_EMAIL: "demo@example.test",
      DASHBOARDIA_DEMO_PASSWORD: "Safe-123",
    });
    assert.equal(result.credentials.status, "READY");
    assert.equal(result.credentials.source, ".dashboardia/demo-access.json");
    assert.equal(result.seedCommand, "java -jar tools/demo-seed.jar");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identifica credenciais já criadas por um bootstrap Java", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  const file = path.join(root, "src/main/java/br/com/app/bootstrap/DemoDataBootstrap.java");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `
    public class DemoDataBootstrap {
      void createAdmin() {
        User user = new User();
        user.setRegistration("admin");
        user.setEmail("admin@demo.local");
        user.setPasswordHash(passwordEncoder.encode("Admin-123"));
      }
    }
  `);
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.equal(result.credentials.status, "READY");
    assert.equal(result.credentials.username, "demo");
    assert.equal(result.credentials.email, "demo@example.test");
    assert.equal(result.credentials.password, "Safe-123");
    assert.equal(result.credentials.source, "src/main/java/br/com/app/bootstrap/DemoDataBootstrap.java");
    const updated = await readFile(file, "utf8");
    assert.doesNotMatch(updated, /Admin-123|admin@demo\.local/);
    assert.match(updated, /setRegistration\("demo"\)/);
    assert.match(updated, /encode\("Safe-123"\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identifica credenciais passadas a uma fábrica de massa Java", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  const file = path.join(root, "src/main/java/br/com/app/bootstrap/DemoDataBootstrap.java");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `
    public class DemoDataBootstrap {
      private User user(String registration, String name, String email, String password, Role role) {
        return new User(registration, name, email, encoder.encode(password), role);
      }
      void load() {
        user("admin", "Administrador", "admin@demo.local", "Admin-456", Role.ADMIN);
      }
    }
  `);
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.equal(result.credentials.username, "demo");
    assert.equal(result.credentials.email, "demo@example.test");
    assert.equal(result.credentials.password, "Safe-123");
    const updated = await readFile(file, "utf8");
    assert.doesNotMatch(updated, /Admin-456|admin@demo\.local/);
    assert.match(updated, /user\(\s*"demo", "Administrador",\s*"demo@example\.test",\s*"Safe-123"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("informa claramente quando uma branch antiga ainda não oferece massa de demonstração", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  await writeFile(path.join(root, "app.py"), "print('sem autenticação configurável')");
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.deepEqual(result, {
      environment: {},
      credentials: {
        status: "NOT_CONFIGURED",
        username: null,
        email: null,
        password: null,
        message: "Este projeto não possui seed ou bootstrap de demonstração compatível para criar um acesso automaticamente.",
        source: null,
      },
      adjustments: [],
      seedCommand: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detecta e prepara o comando de seed de um monorepo Node", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-demo-access-"));
  const file = path.join(root, "backend/package.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ scripts: { "seed:demo": "node prisma/seed.js" } }));
  await writeFile(path.join(root, "backend/seed_data.py"), "# massa de teste");
  try {
    const result = await prepareDemoAccess({
      sourceDirectory: root,
      workingDirectory: ".",
      credentials: { username: "demo", email: "demo@example.test", password: "Safe-123" },
    });
    assert.equal(result.seedCommand, "npm --prefix \"backend\" run seed:demo");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
