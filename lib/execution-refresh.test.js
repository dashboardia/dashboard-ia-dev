import assert from "node:assert/strict";
import { test } from "vitest";

import { isExecutionLive, shouldPollPreview } from "./execution-refresh.js";

test("mantém a execução atualizando enquanto ainda pode mudar", () => {
  assert.equal(isExecutionLive("RUNNING"), true);
  assert.equal(isExecutionLive("WAITING_APPROVAL"), true);
  assert.equal(isExecutionLive("WAITING_APPROVAL", true), false);
  assert.equal(isExecutionLive("COMPLETED"), false);
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
