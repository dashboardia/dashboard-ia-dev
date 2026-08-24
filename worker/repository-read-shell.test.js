import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RepositoryReadShell, tokenizeRepositoryReadCommand } from "./repository-read-shell.mjs";
import { runProcess } from "./sandbox.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("repository read shell", () => {
  it("tokeniza argumentos entre aspas sem permitir composição de comandos", () => {
    expect(tokenizeRepositoryReadCommand("sed -n '1,20p' src/app.js"))
      .toEqual(["sed", "-n", "1,20p", "src/app.js"]);
    expect(() => tokenizeRepositoryReadCommand("pwd; cat .env")).toThrow(/bloqueado/);
  });

  it("inspeciona o repositório sem disponibilizar um shell arbitrário", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-reader-"));
    directories.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "app.js"), "primeira\nhello dashboardia\nterceira\n");
    const shell = new RepositoryReadShell(workspace);

    const result = await shell.run({
      commands: [
        "sed -n '1,2p' src/app.js",
        "rg -n hello .",
        "cat src/app.js",
        "node src/app.js",
      ],
    });

    expect(result.output[0].stdout).toContain("primeira\nhello dashboardia");
    expect(result.output[1].stdout).toContain("src/app.js:2:hello dashboardia");
    expect(result.output[2].outcome.exitCode).toBe(126);
    expect(result.output[3].outcome.exitCode).toBe(126);
  });

  it("não permite leitura fora do workspace nem opções destrutivas", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-reader-"));
    directories.push(workspace);
    const shell = new RepositoryReadShell(workspace);

    const result = await shell.run({
      commands: [
        "head -n 1 /etc/passwd",
        "find . -exec cat {}",
        "git diff --output=/tmp/diff.txt",
      ],
    });

    expect(result.output.every((item) => item.outcome.exitCode === 126)).toBe(true);
  });

  it("exclui arquivos de ambiente e diretórios internos das buscas", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-reader-"));
    directories.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, ".env"), "DASHBOARDIA_SECRET=nao-vazar\n");
    await writeFile(path.join(workspace, "src", "app.js"), "const label = 'dashboardia';\n");
    const shell = new RepositoryReadShell(workspace);

    const result = await shell.run({
      commands: [
        "rg -n DASHBOARDIA_SECRET .",
        "find . -maxdepth 3 -type f",
      ],
    });

    expect(result.output[0].stdout).not.toContain("DASHBOARDIA_SECRET");
    expect(result.output[1].stdout).not.toContain(".env");
    expect(result.output[1].stdout).toContain("src/app.js");
  });

  it("mantém somente operações git de leitura", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-reader-"));
    directories.push(workspace);
    await runProcess("git", ["init"], { cwd: workspace });
    const shell = new RepositoryReadShell(workspace);

    const result = await shell.run({ commands: ["git status --short", "git branch --show-current"] });

    expect(result.output.every((item) => item.outcome.exitCode === 0)).toBe(true);
  });

  it("importa somente anexos autorizados para um destino relativo seguro", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-reader-"));
    const attachmentDirectory = await mkdtemp(path.join(os.tmpdir(), "dashboardia-attachment-"));
    directories.push(workspace, attachmentDirectory);
    const sourcePath = path.join(attachmentDirectory, "foto.png");
    await writeFile(sourcePath, Buffer.from("imagem-real"));
    const shell = new RepositoryReadShell(workspace, {
      attachments: [{ id: "arquivo-1", name: "foto.png", sourcePath }],
    });

    const result = await shell.run({
      commands: ['dashboardia-import-attachment arquivo-1 "public/images/foto.png"'],
    });

    expect(result.output[0].outcome.exitCode).toBe(0);
    await expect(readFile(path.join(workspace, "public/images/foto.png"), "utf8")).resolves.toBe("imagem-real");
  });

  it("bloqueia anexos desconhecidos e destinos por link simbólico", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-reader-"));
    const attachmentDirectory = await mkdtemp(path.join(os.tmpdir(), "dashboardia-attachment-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "dashboardia-outside-"));
    directories.push(workspace, attachmentDirectory, outside);
    const sourcePath = path.join(attachmentDirectory, "foto.png");
    await writeFile(sourcePath, Buffer.from("imagem-real"));
    await symlink(outside, path.join(workspace, "escape"));
    const shell = new RepositoryReadShell(workspace, {
      attachments: [{ id: "arquivo-1", name: "foto.png", sourcePath }],
    });

    const result = await shell.run({
      commands: [
        "dashboardia-import-attachment arquivo-2 public/foto.png",
        "dashboardia-import-attachment arquivo-1 escape/foto.png",
      ],
    });

    expect(result.output.every((item) => item.outcome.exitCode === 126)).toBe(true);
  });
});
