import assert from "node:assert/strict";
import test from "node:test";

import { executionControlState } from "./execution-control-state.js";

function execution(overrides = {}) {
  return {
    status: "AWAITING_CLIENT",
    branchName: "feature/demo",
    headSha: "abc123",
    closedAt: null,
    cancelRequestedAt: null,
    stopRequestedAt: null,
    error: null,
    demand: { type: "IMPLEMENTATION" },
    previewEnvironment: { status: "BUILDING", url: null },
    ...overrides,
  };
}

test("não anuncia aguardando cliente antes do ambiente ficar pronto", () => {
  const state = executionControlState(execution());
  assert.equal(state.awaitingEnvironment, true);
  assert.equal(state.interactionAvailable, false);
  assert.equal(state.displayStatus, "Preparando ambiente");
  assert.equal(state.environmentStatus, "Preparando ambiente");
  assert.equal(state.displayTone, "active");
});

test("falha do ambiente aparece como falha enquanto o cliente ainda não pode agir", () => {
  const state = executionControlState(execution({ previewEnvironment: { status: "FAILED", url: null } }));
  assert.equal(state.interactionAvailable, false);
  assert.equal(state.displayStatus, "Falha no ambiente");
  assert.equal(state.environmentStatus, "Ambiente com falha");
  assert.equal(state.displayTone, "failed");
});

test("libera aguardando cliente somente quando o ambiente está pronto", () => {
  const state = executionControlState(execution({ previewEnvironment: { status: "READY", url: "https://example.test" } }));
  assert.equal(state.previewReady, true);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando cliente");
  assert.equal(state.environmentStatus, "Ambiente pronto");
  assert.equal(state.displayTone, "waiting");
});

test("documentação pode aguardar cliente sem ambiente navegável", () => {
  const state = executionControlState(execution({
    demand: { type: "DOCUMENTATION" },
    branchName: null,
    headSha: null,
    previewEnvironment: null,
  }));
  assert.equal(state.previewReady, true);
  assert.equal(state.awaitingEnvironment, false);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando cliente");
});

test("correção real aparece como atividade secundária durante processamento", () => {
  const state = executionControlState(execution({ status: "RUNNING", previewEnvironment: { status: "FAILED", url: null } }));
  assert.equal(state.previewState, "REPAIRING");
  assert.equal(state.displayStatus, "IA trabalhando");
  assert.equal(state.environmentStatus, "Corrigindo ambiente");
  assert.equal(state.interactionAvailable, false);
});

test("nova interação invalida o ambiente anterior até republicar", () => {
  const state = executionControlState(execution({ status: "RUNNING", previewEnvironment: { status: "READY", url: "https://old.example" } }));
  assert.equal(state.previewState, "WAITING_IMPLEMENTATION");
  assert.equal(state.displayStatus, "IA trabalhando");
  assert.equal(state.environmentStatus, "Aguardando nova publicação");
});

test("execução pausada mantém um único status canônico", () => {
  const state = executionControlState(execution({ status: "STOPPED", stopRequestedAt: new Date() }));
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.canResume, true);
  assert.equal(state.displayStatus, "Pausada");
});
