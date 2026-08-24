import assert from "node:assert/strict";
import test from "node:test";

import { executionControlState } from "./execution-control-state.js";

function execution(overrides = {}) {
  return {
    status: "AWAITING_CLIENT",
    branchName: "feature/demo",
    headSha: "abc123",
    updatedAt: new Date("2026-08-22T22:10:00.000Z"),
    closedAt: null,
    cancelRequestedAt: null,
    stopRequestedAt: null,
    error: null,
    demand: { type: "IMPLEMENTATION" },
    previewEnvironment: { status: "BUILDING", url: null, readyAt: null },
    ...overrides,
  };
}

test("mostra preparação do ambiente sem bloquear o chat", () => {
  const state = executionControlState(execution());
  assert.equal(state.awaitingEnvironment, true);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Preparando ambiente");
  assert.equal(state.environmentStatus, "Preparando ambiente");
  assert.equal(state.displayTone, "active");
});

test("READY antigo não é confundido com a publicação da interação atual", () => {
  const state = executionControlState(execution({
    previewEnvironment: {
      status: "READY",
      url: "https://old.example.test",
      readyAt: new Date("2026-08-22T22:00:00.000Z"),
    },
  }));
  assert.equal(state.previewReady, false);
  assert.equal(state.awaitingEnvironment, false);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando cliente");
});

test("libera aguardando cliente somente quando o ambiente atual está pronto", () => {
  const state = executionControlState(execution({
    previewEnvironment: {
      status: "READY",
      url: "https://example.test",
      readyAt: new Date("2026-08-22T22:10:03.000Z"),
    },
  }));
  assert.equal(state.previewReady, true);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando cliente");
  assert.equal(state.environmentStatus, "Ambiente pronto");
  assert.equal(state.displayTone, "waiting");
});

test("falha do ambiente não bloqueia o cliente nem substitui o status da execução", () => {
  const state = executionControlState(execution({ previewEnvironment: { status: "FAILED", url: null, readyAt: null } }));
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando cliente");
  assert.equal(state.environmentStatus, "Ambiente com falha");
  assert.equal(state.displayTone, "waiting");
  assert.equal(state.canRestartEnvironment, true);
});

test("pede uma decisão coerente depois das correções automáticas do código", () => {
  const state = executionControlState(execution({
    previewEnvironment: {
      status: "FAILED",
      url: null,
      readyAt: null,
      error: "[PREVIEW_REPAIR_CONSENT] Cannot find module 'express'",
    },
  }));
  assert.equal(state.awaitingPreviewRepairConsent, true);
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando decisão");
  assert.equal(state.canRestartEnvironment, false);
});

test("ambiente expirado pode ser republicado sem bloquear o chat", () => {
  const state = executionControlState(execution({ previewEnvironment: { status: "EXPIRED", url: null, readyAt: null } }));
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.displayStatus, "Aguardando cliente");
  assert.equal(state.environmentStatus, "Ambiente encerrado");
  assert.equal(state.canRestartEnvironment, true);
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
  const state = executionControlState(execution({ status: "RUNNING", previewEnvironment: { status: "FAILED", url: null, readyAt: null } }));
  assert.equal(state.previewState, "REPAIRING");
  assert.equal(state.displayStatus, "IA trabalhando");
  assert.equal(state.environmentStatus, "Corrigindo ambiente");
  assert.equal(state.interactionAvailable, false);
});

test("nova interação invalida o ambiente anterior até republicar", () => {
  const state = executionControlState(execution({ status: "RUNNING", previewEnvironment: { status: "READY", url: "https://old.example", readyAt: new Date("2026-08-22T22:00:00.000Z") } }));
  assert.equal(state.previewState, "WAITING_IMPLEMENTATION");
  assert.equal(state.displayStatus, "IA trabalhando");
  assert.equal(state.environmentStatus, "Aguardando nova publicação");
});

test("execução pausada mantém um único status canônico", () => {
  const state = executionControlState(execution({ status: "STOPPED", stopRequestedAt: new Date(), previewEnvironment: { status: "EXPIRED", url: null, readyAt: null } }));
  assert.equal(state.interactionAvailable, true);
  assert.equal(state.canResume, true);
  assert.equal(state.canRestartEnvironment, true);
  assert.equal(state.displayStatus, "Pausada");
});

test("saldo insuficiente bloqueia novo envio e explica o estado real", () => {
  const state = executionControlState(execution({
    error: "A execução ultrapassou o limite de 6 créditos, calculado sobre 5 créditos disponíveis.",
    previewEnvironment: { status: "READY", url: "https://example.test", readyAt: new Date("2026-08-22T22:10:03.000Z") },
  }));
  assert.equal(state.creditBlocked, true);
  assert.equal(state.interactionAvailable, false);
  assert.equal(state.displayStatus, "Aguardando créditos");
});
