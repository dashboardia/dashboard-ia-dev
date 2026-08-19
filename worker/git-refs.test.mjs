import assert from "node:assert/strict";
import { test } from "vitest";

import { remoteFetchRefspec, remoteTrackingRef } from "./git-refs.mjs";

test("cria explicitamente a referência remota da branch base", () => {
  assert.equal(remoteTrackingRef("main"), "refs/remotes/origin/main");
  assert.equal(remoteFetchRefspec("main"), "+refs/heads/main:refs/remotes/origin/main");
});

test("preserva branches com barras", () => {
  assert.equal(remoteFetchRefspec("release/2026"), "+refs/heads/release/2026:refs/remotes/origin/release/2026");
});
