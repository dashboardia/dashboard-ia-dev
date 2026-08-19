import assert from "node:assert/strict";
import { test } from "vitest";

import { isExecutionLive, isExecutionSettling, shouldPollPreview } from "./execution-refresh.js";

test("mantém a execução atualizando enquanto ainda pode mudar", () => {
  assert.equal(isExecutionLive("RUNNING"), true);
  assert.equal(isExecutionLive("WAITING_APPROVAL"), true);
  assert.equal(isExecutionLive("WAITING_APPROVAL", true), false);
  assert.equal(isExecutionLive("COMPLETED"), false);
});

test("mantém atualizações por um período após a transição final", () => {
  const now = new Date("2026-08-19T22:00:30.000Z");
  assert.equal(isExecutionSettling({ status: "AWAITING_CLIENT", updatedAt: "2026-08-19T22:00:10.000Z" }, now), true);
  assert.equal(isExecutionSettling({ status: "SUCCEEDED", finishedAt: "2026-08-19T22:00:05.000Z" }, now), true);
  assert.equal(isExecutionSettling({ status: "AWAITING_CLIENT", updatedAt: "2026-08-19T21:59:00.000Z" }, now), false);
  assert.equal(isExecutionSettling({ status: "RUNNING", updatedAt: "2026-08-19T21:59:00.000Z" }, now), false);
});

test("continua procurando o preview depois do fallback visual temporário", () => {
  assert.equal(shouldPollPreview("NOT_READY", "RUNNING"), true);
  assert.equal(shouldPollPreview("EVIDENCE", "WAITING_APPROVAL"), true);
  assert.equal(shouldPollPreview("UNAVAILABLE", "WAITING_APPROVAL"), true);
  assert.equal(shouldPollPreview("AVAILABLE", "WAITING_APPROVAL"), false);
  assert.equal(shouldPollPreview("PREPARING", "SUCCEEDED"), true);
  assert.equal(shouldPollPreview("EVIDENCE", "SUCCEEDED"), true);
  assert.equal(shouldPollPreview("AVAILABLE", "SUCCEEDED"), false);
  assert.equal(shouldPollPreview("EVIDENCE", "COMPLETED"), true);
});
