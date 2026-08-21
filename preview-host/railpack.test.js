import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { ensureRustToolchainVersion } from "./railpack.mjs";

test("cria uma versão Rust moderna somente na cópia temporária sem versão explícita", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-rust-"));
  try {
    await writeFile(path.join(root, "Cargo.toml"), '[package]\nname = "app"\nedition = "2021"\n');
    assert.equal(await ensureRustToolchainVersion(root), true);
    assert.equal(await readFile(path.join(root, ".rust-version"), "utf8"), "1.89\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserva a versão Rust declarada pelo projeto", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-rust-"));
  try {
    await writeFile(path.join(root, "Cargo.toml"), '[package]\nname = "app"\nrust-version = "1.86"\n');
    assert.equal(await ensureRustToolchainVersion(root), false);
    await assert.rejects(readFile(path.join(root, ".rust-version"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
