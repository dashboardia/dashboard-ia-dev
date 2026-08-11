import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ReadOnlyShell, resolveWorkspacePath, WorkspaceEditor } from "./sandbox.mjs";

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

  it("recusa patches em arquivos protegidos", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-test-"));
    directories.push(workspace);
    const editor = new WorkspaceEditor(workspace);
    const result = await editor.deleteFile({ type: "delete_file", path: ".env" });
    expect(result.status).toBe("failed");
    expect(result.output).toContain("protegido");
  });
});
