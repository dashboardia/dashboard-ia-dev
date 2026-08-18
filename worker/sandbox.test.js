import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanValidationArtifacts, ReadOnlyShell, redactSensitiveData, resolveWorkspacePath, restoreImplementationSnapshot, runConfiguredCommand, runProcess, safeChildEnvironment, WorkspaceEditor } from "./sandbox.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("worker sandbox", () => {
  it("impede caminhos fora do workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    expect(() => resolveWorkspacePath(workspace, "../segredo")).toThrow("fora do workspace");
  });

  it("bloqueia comandos compostos e destrutivos", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    const shell = new ReadOnlyShell(workspace);
    const result = await shell.run({ commands: ["pwd; rm -rf ."] });
    expect(result.output[0].outcome.exitCode).toBe(126);
  });

  it("bloqueia edição de arquivos pelo sed", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    const shell = new ReadOnlyShell(workspace);
    const result = await shell.run({ commands: ["sed -i s/antes/depois/ arquivo.txt"] });
    expect(result.output[0].outcome.exitCode).toBe(126);
  });

  it("preserva o limite solicitado no resultado do shell", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    const shell = new ReadOnlyShell(workspace);
    const result = await shell.run({ commands: ["pwd"], maxOutputLength: 30_000 });
    expect(result.maxOutputLength).toBe(30_000);
  });

  it("recusa patches em arquivos protegidos", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    const editor = new WorkspaceEditor(workspace);
    const result = await editor.deleteFile({ type: "delete_file", path: ".env" });
    expect(result.status).toBe("failed");
    expect(result.output).toContain("protegido");
  });

  it("remove credenciais de mensagens", () => {
    expect(redactSensitiveData("Authorization: Basic abc123 token-secreto", ["token-secreto"]))
      .toBe("Authorization: Basic [REDACTED] [REDACTED]");
  });

  it("não repassa credenciais internas do worker aos projetos executados", () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.OPENAI_API_KEY = "segredo-do-worker";
    process.env.DATABASE_URL = "postgresql://interno";
    try {
      const environment = safeChildEnvironment("/tmp/projeto");
      expect(environment.OPENAI_API_KEY).toBeUndefined();
      expect(environment.DATABASE_URL).toBeUndefined();
    } finally {
      if (previousOpenAiKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousDatabaseUrl == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it("encerra comandos configurados quando o limite é atingido", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    const startedAt = Date.now();

    await expect(runConfiguredCommand("sleep 30", workspace, 50)).rejects.toThrow("excedeu o limite");
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it("isola comandos Python em um ambiente virtual do workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-python-"));
    directories.push(workspace);

    const result = await runConfiguredCommand("python -c 'import sys; print(sys.prefix)' && pip --version", workspace);

    expect(result.stdout).toContain(path.join(workspace, ".forgeboard-venv"));
    expect(result.stdout).toContain(path.join(workspace, ".forgeboard-venv", "lib"));
  });

  it("remove artefatos temporários antes de preparar o commit", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-clean-"));
    directories.push(workspace);
    await mkdir(path.join(workspace, ".forgeboard-venv"), { recursive: true });
    await mkdir(path.join(workspace, ".tmp"), { recursive: true });

    await cleanValidationArtifacts(workspace);

    await expect(access(path.join(workspace, ".forgeboard-venv"))).rejects.toThrow();
    await expect(access(path.join(workspace, ".tmp"))).rejects.toThrow();
  });

  it("descarta alterações produzidas pelas validações sem perder a implementação", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-snapshot-"));
    directories.push(workspace);
    await runProcess("git", ["init"], { cwd: workspace });
    await runProcess("git", ["config", "user.name", "Forgeboard Test"], { cwd: workspace });
    await runProcess("git", ["config", "user.email", "forgeboard-test@example.com"], { cwd: workspace });
    await writeFile(path.join(workspace, "app.js"), "console.log('base');\n");
    await runProcess("git", ["add", "app.js"], { cwd: workspace });
    await runProcess("git", ["commit", "-m", "base"], { cwd: workspace });

    await writeFile(path.join(workspace, "app.js"), "console.log('hello world');\n");
    await writeFile(path.join(workspace, "hello.txt"), "implementação\n");
    await runProcess("git", ["add", "-A"], { cwd: workspace });
    await runProcess("git", ["commit", "-m", "implementação"], { cwd: workspace });
    const implementationHead = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();

    await writeFile(path.join(workspace, "app.js"), "arquivo alterado pelo build\n");
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await writeFile(path.join(workspace, "dist", "bundle.js"), "artefato do build\n");
    await restoreImplementationSnapshot(workspace, implementationHead);

    await expect(readFile(path.join(workspace, "app.js"), "utf8")).resolves.toBe("console.log('hello world');\n");
    await expect(readFile(path.join(workspace, "hello.txt"), "utf8")).resolves.toBe("implementação\n");
    await expect(access(path.join(workspace, "dist"))).rejects.toThrow();
    expect((await runProcess("git", ["status", "--porcelain"], { cwd: workspace })).stdout).toBe("");
  });

  it("não expõe segredos quando um processo falha", async () => {
    await expect(runProcess(process.execPath, ["-e", "process.stderr.write(process.argv[1]); process.exit(1)", "token-secreto"], {
      cwd: process.cwd(),
      secrets: ["token-secreto"],
    })).rejects.not.toThrow("token-secreto");
  });
});
