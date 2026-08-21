import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function ensureRubyLockfile(sourceDirectory) {
  const gemfile = path.join(sourceDirectory, "Gemfile");
  const lockfile = path.join(sourceDirectory, "Gemfile.lock");
  const hasGemfile = await readFile(gemfile, "utf8").then(() => true).catch(() => false);
  const hasLockfile = await readFile(lockfile, "utf8").then(() => true).catch(() => false);
  if (!hasGemfile || hasLockfile) return false;
  await writeFile(lockfile, "", { mode: 0o600 });
  return true;
}

export async function ensureRustToolchainVersion(sourceDirectory) {
  const rubyLockfileCreated = await ensureRubyLockfile(sourceDirectory);
  const cargo = await readFile(path.join(sourceDirectory, "Cargo.toml"), "utf8").catch(() => null);
  if (cargo == null || /^\s*rust-version\s*=/m.test(cargo)) return rubyLockfileCreated;

  for (const file of [".rust-version", "rust-toolchain", "rust-toolchain.toml"]) {
    if (await readFile(path.join(sourceDirectory, file), "utf8").then(() => true).catch(() => false)) return rubyLockfileCreated;
  }

  const toolVersions = await readFile(path.join(sourceDirectory, ".tool-versions"), "utf8").catch(() => "");
  const miseConfiguration = await readFile(path.join(sourceDirectory, "mise.toml"), "utf8").catch(() => "");
  if (/^\s*rust\s+/m.test(toolVersions) || /^\s*rust\s*=/m.test(miseConfiguration)) return rubyLockfileCreated;

  await writeFile(path.join(sourceDirectory, ".rust-version"), "1.89\n", { mode: 0o600 });
  return true;
}
