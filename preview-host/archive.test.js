import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { expectedRepositoryPaths, normalizeExtractedRepository } from "./archive.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dashboardia-archive-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("normalizeExtractedRepository", () => {
  it("remove diretórios extras até expor o monorepo na raiz", async () => {
    const directory = await temporaryDirectory();
    const backend = path.join(directory, "github-archive", "project", "backend");
    await mkdir(backend, { recursive: true });
    await writeFile(path.join(backend, "requirements.txt"), "flask\n");

    await expect(normalizeExtractedRepository(directory, ["backend"])).resolves.toEqual(["github-archive", "project"]);
    await expect(readFile(path.join(directory, "backend", "requirements.txt"), "utf8")).resolves.toBe("flask\n");
  });

  it("preserva uma raiz que já contém arquivos e diretórios do projeto", async () => {
    const directory = await temporaryDirectory();
    await mkdir(path.join(directory, "backend"));
    await writeFile(path.join(directory, "README.md"), "projeto");

    await expect(normalizeExtractedRepository(directory, ["backend"])).resolves.toEqual([]);
    await expect(readFile(path.join(directory, "README.md"), "utf8")).resolves.toBe("projeto");
  });

  it("extrai os diretórios esperados dos comandos de um monorepo", () => {
    expect(expectedRepositoryPaths({
      installCommand: "(cd backend && pip install -r requirements.txt) && npm --prefix frontend ci",
      previewCommand: "cd frontend && npm run dev",
      workingDirectory: ".",
    })).toEqual(["backend", "frontend", "frontend"]);
  });
});
