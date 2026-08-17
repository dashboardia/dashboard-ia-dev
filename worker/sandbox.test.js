import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ReadOnlyShell, redactSensitiveData, resolveWorkspacePath, runConfiguredCommand, runProcess, WorkspaceEditor } from "./sandbox.mjs";

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

  it("não expõe segredos quando um processo falha", async () => {
    await expect(runProcess(process.execPath, ["-e", "process.stderr.write(process.argv[1]); process.exit(1)", "token-secreto"], {
      cwd: process.cwd(),
      secrets: ["token-secreto"],
    })).rejects.not.toThrow("token-secreto");
  });
});
