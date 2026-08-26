import assert from "node:assert/strict";
import test from "node:test";

import { executionRevision, isExecutionLive, isExecutionSettling, shouldPollExecutionDetail, shouldPollPreview } from "./execution-refresh.js";

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

test("mantém o detalhe sincronizado em todos os estados que ainda aceitam mudanças", () => {
  assert.equal(shouldPollExecutionDetail({ status: "RUNNING", closedAt: null }), true);
  assert.equal(shouldPollExecutionDetail({ status: "AWAITING_CLIENT", closedAt: null }), true);
  assert.equal(shouldPollExecutionDetail({ status: "STOPPED", closedAt: null }), true);
  assert.equal(shouldPollExecutionDetail({ status: "FAILED", closedAt: null }), true);
  assert.equal(shouldPollExecutionDetail({ status: "SUCCEEDED", closedAt: new Date() }), false);
  assert.equal(shouldPollExecutionDetail({ status: "CANCELLED", closedAt: null }), false);
});

test("a revisão muda quando uma resposta ou evento novo é gravado", () => {
  const execution = {
    updatedAt: new Date("2026-08-24T12:00:00.000Z"),
    status: "RUNNING",
    stage: "IMPLEMENTATION",
    messages: [{ id: "message-1" }],
    logs: [{ id: "log-1" }],
    artifacts: [],
  };
  const initial = executionRevision(execution);
  assert.notEqual(executionRevision({ ...execution, messages: [...execution.messages, { id: "message-2" }] }), initial);
  assert.notEqual(executionRevision(execution, { logId: "log-2" }), initial);
});

test("a revisão muda quando o ambiente é recuperado sem alterar a execução", () => {
  const execution = {
    updatedAt: new Date("2026-08-24T12:00:00.000Z"),
    status: "AWAITING_CLIENT",
    stage: "PUBLISH",
    previewEnvironment: {
      status: "FAILED",
      url: null,
      updatedAt: new Date("2026-08-24T12:01:00.000Z"),
    },
  };
  const initial = executionRevision(execution);
  assert.notEqual(executionRevision({
    ...execution,
    previewEnvironment: {
      status: "READY",
      url: "https://preview.example.test",
      updatedAt: new Date("2026-08-24T12:02:00.000Z"),
    },
  }), initial);
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
