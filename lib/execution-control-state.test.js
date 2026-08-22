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

test("bloqueia interação enquanto o ambiente está sendo preparado", () => {
  const state = executionControlState(execution());
  assert.equal(state.awaitingEnvironment, true);
  assert.equal(state.interactionAvailable, false);
  assert.equal(state.displayStatus, "Preparando ambiente");
});

test("falha de ambiente ainda não é anunciada como correção em andamento", () => {
  const state = executionControlState(execution({ previewEnvironment: { status: "FAILED", url: null } }));
  assert.equal(state.interactionAvailable, false);
  assert.equal(state.displayStatus, "Ambiente com falha");
});

test("libera interação somente quando o ambiente está pronto", () => {
  const state = executionControlState(execution({ previewEnvironment: { status: "READY", url: "https://example.test" } }));
  assert.equal(state.previewReady, true);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando você");
});

test("mostra correção real quando execução voltou para o worker após falha do ambiente", () => {
  const state = executionControlState(execution({ status: "RUNNING", previewEnvironment: { status: "FAILED", url: null } }));
  assert.equal(state.previewState, "REPAIRING");
  assert.equal(state.displayStatus, "IA corrigindo ambiente");
  assert.equal(state.interactionAvailable, false);
});

test("nova interação invalida visualmente o ambiente anterior até republicar", () => {
  const state = executionControlState(execution({ status: "RUNNING", previewEnvironment: { status: "READY", url: "https://old.example" } }));
  assert.equal(state.previewState, "WAITING_IMPLEMENTATION");
  assert.equal(state.displayStatus, "IA aplicando ajuste");
});

test("execução pausada pode receber interação e ser retomada", () => {
  const state = executionControlState(execution({ status: "STOPPED", stopRequestedAt: new Date() }));
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.canResume, true);
  assert.equal(state.displayStatus, "Processos pausados");
});
