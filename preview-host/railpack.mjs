import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureRustToolchainVersion(sourceDirectory) {
  const cargo = await readFile(path.join(sourceDirectory, "Cargo.toml"), "utf8").catch(() => null);
  if (cargo == null || /^\s*rust-version\s*=/m.test(cargo)) return false;

  for (const file of [".rust-version", "rust-toolchain", "rust-toolchain.toml"]) {
    if (await readFile(path.join(sourceDirectory, file), "utf8").then(() => true).catch(() => false)) return false;
  }

  const toolVersions = await readFile(path.join(sourceDirectory, ".tool-versions"), "utf8").catch(() => "");
  const miseConfiguration = await readFile(path.join(sourceDirectory, "mise.toml"), "utf8").catch(() => "");
  if (/^\s*rust\s+/m.test(toolVersions) || /^\s*rust\s*=/m.test(miseConfiguration)) return false;

  await writeFile(path.join(sourceDirectory, ".rust-version"), "1.89\n", { mode: 0o600 });
  return true;
}
