import { access, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

// Git providers normally wrap archives in one directory. Some monorepos arrive
// with an additional wrapper, even after tar --strip-components=1. Flatten only
// when the extracted directory contains exactly one child directory, preserving
// normal repositories and their dotfiles untouched.
async function anyExpectedPathExists(sourceDirectory, expectedPaths) {
  for (const expectedPath of expectedPaths) {
    try {
      await access(path.join(sourceDirectory, expectedPath));
      return true;
    } catch {}
  }
  return false;
}

export async function normalizeExtractedRepository(sourceDirectory, expectedPaths, maximumLevels = 3) {
  const normalizedExpectedPaths = [...new Set((expectedPaths ?? [])
    .map((value) => String(value || "").replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((value) => value && value !== "." && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..")))];
  if (!normalizedExpectedPaths.length) return [];
  const flattenedDirectories = [];
  for (let level = 0; level < maximumLevels; level += 1) {
    if (await anyExpectedPathExists(sourceDirectory, normalizedExpectedPaths)) break;
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) break;
    const wrapperName = entries[0].name;
    const wrapperDirectory = path.join(sourceDirectory, wrapperName);
    const children = await readdir(wrapperDirectory);
    for (const child of children) {
      await rename(path.join(wrapperDirectory, child), path.join(sourceDirectory, child));
    }
    await rm(wrapperDirectory, { recursive: true, force: true });
    flattenedDirectories.push(wrapperName);
  }
  return flattenedDirectories;
}

export function expectedRepositoryPaths(configuration) {
  const commands = [configuration.installCommand, configuration.buildCommand, configuration.previewCommand].filter(Boolean).join("\n");
  const paths = [];
  for (const match of commands.matchAll(/(?:\bcd\s+|--prefix\s+)([A-Za-z0-9._/-]+)/g)) paths.push(match[1]);
  if (configuration.workingDirectory && configuration.workingDirectory !== ".") paths.push(configuration.workingDirectory);
  return paths;
}
