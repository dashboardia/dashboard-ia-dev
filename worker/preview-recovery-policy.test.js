import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_AUTOMATIC_APPLICATION_REPAIRS,
  MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS,
  applicationRepairDecision,
  automaticApplicationRepairCount,
  automaticPreviewCorrectionRequeueData,
  classifyPreviewFailure,
  isRetryableInfrastructureFailure,
  normalizePreviewFailure,
  previewFailureSignature,
  shouldInvokePreviewRepairAi,
} from "./preview-recovery-policy.mjs";

test("classifica falha de archive/tar como infraestrutura retentável", () => {
  const error = `tar (child): /var/lib/dashboardia-previews/work/cmt4un8sk001lp42b252x72hh/source.tar.gz: Cannot open: No such file or directory\ntar: Child returned status 2`;
  assert.equal(classifyPreviewFailure(error), "INFRASTRUCTURE");
  assert.equal(isRetryableInfrastructureFailure(error), true);
});

test("classifica archive truncado como infraestrutura", () => {
  const error = "gzip: stdin: unexpected end of file\ntar: Unexpected EOF in archive";
  assert.equal(classifyPreviewFailure(error), "INFRASTRUCTURE");
  assert.equal(isRetryableInfrastructureFailure(error), true);
});

test("só classifica como aplicação quando existe evidência de código/build/startup", () => {
  assert.equal(classifyPreviewFailure("npm ERR! Module not found: Cannot find module './src/app'"), "APPLICATION");
  assert.equal(classifyPreviewFailure("[INFRASTRUCTURE] falha interna não detalhada"), "INFRASTRUCTURE");
  assert.equal(classifyPreviewFailure("[UNSUPPORTED] stack sem inicialização navegável"), "UNKNOWN");
  assert.equal(classifyPreviewFailure("falha desconhecida sem evidência causal"), "UNKNOWN");
});

test("não cobra correção por IA quando o log comprova respostas 2xx", () => {
  const error = `[APPLICATION] O processo deixou de responder.\nGET / 200 in 9.1s (compile: 4.2s, render: 4.9s)\nÚltimos logs do container:\n✓ Ready`;
  assert.equal(classifyPreviewFailure(error), "INFRASTRUCTURE");
  assert.equal(isRetryableInfrastructureFailure(error), true);
});

test("mantém como aplicação um erro explícito mesmo com respostas anteriores", () => {
  const error = `GET / 200 in 1.2s\nnpm ERR! Cannot find module './src/app'`;
  assert.equal(classifyPreviewFailure(error), "APPLICATION");
});

test("autorização anterior nunca transforma infraestrutura em correção cobrada", () => {
  assert.equal(shouldInvokePreviewRepairAi("INFRASTRUCTURE", true), false);
  assert.equal(shouldInvokePreviewRepairAi("UNKNOWN", true), true);
  assert.equal(shouldInvokePreviewRepairAi("APPLICATION", false), true);
});

test("assinatura ignora o id dinâmico do diretório de preview", () => {
  const first = "tar (child): /var/lib/dashboardia-previews/work/cmt4un8sk001lp42b252x72hh/source.tar.gz: Cannot open";
  const second = "tar (child): /var/lib/dashboardia-previews/work/cmt999999999999999999999/source.tar.gz: Cannot open";
  assert.equal(normalizePreviewFailure(first), normalizePreviewFailure(second));
  assert.equal(previewFailureSignature(first), previewFailureSignature(second));
});

test("correção automática inicia um novo ciclo sem herdar falhas do worker anterior", () => {
  const data = automaticPreviewCorrectionRequeueData({ now: new Date("2026-08-22T18:00:00-03:00"), timeoutMinutes: 30 });
  assert.equal(data.attempts, 0);
  assert.equal(data.status, "QUEUED");
  assert.equal(data.stage, "IMPLEMENTATION");
  assert.equal(MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS, 3);
  assert.equal(MAX_AUTOMATIC_APPLICATION_REPAIRS, 3);
});

test("conta somente correções automáticas de falhas atribuídas à aplicação", () => {
  const logs = [
    { metadata: { automatic: true, aiInvoked: true, failureClass: "APPLICATION" } },
    { metadata: { automatic: true, aiInvoked: true, failureClass: "APPLICATION" } },
    { metadata: { automatic: true, aiInvoked: false, failureClass: "INFRASTRUCTURE" } },
    { metadata: { automatic: false, aiInvoked: true, failureClass: "APPLICATION" } },
  ];
  assert.equal(automaticApplicationRepairCount(logs), 2);
});

test("mantém falha de aplicação classificável quando aguarda consentimento", () => {
  assert.equal(classifyPreviewFailure("[PREVIEW_REPAIR_CONSENT] Cannot find module 'express'"), "APPLICATION");
});

test("faz três correções de código por ciclo e pede consentimento antes do próximo bloco", () => {
  const repairLog = { metadata: { automatic: true, aiInvoked: true, failureClass: "APPLICATION" } };
  assert.deepEqual(applicationRepairDecision({ logs: [] }), {
    action: "AUTO_REPAIR",
    automaticRepairCount: 0,
    repairCycleCount: 0,
    repairNumber: 1,
    reason: "within-automatic-limit",
  });
  assert.equal(applicationRepairDecision({ logs: [repairLog] }).action, "AUTO_REPAIR");
  assert.equal(applicationRepairDecision({ logs: [repairLog, repairLog] }).action, "AUTO_REPAIR");
  assert.equal(applicationRepairDecision({ logs: [repairLog, repairLog, repairLog] }).action, "REQUEST_CONSENT");
  const consent = { createdAt: "2026-08-24T12:03:00.000Z", metadata: { aiInvoked: true, failureClass: "APPLICATION", previewRepairConsentGranted: true } };
  const oldRepairs = [
    { ...repairLog, createdAt: "2026-08-24T12:00:00.000Z" },
    { ...repairLog, createdAt: "2026-08-24T12:01:00.000Z" },
    { ...repairLog, createdAt: "2026-08-24T12:02:00.000Z" },
  ];
  assert.equal(applicationRepairDecision({ logs: [...oldRepairs, consent] }).repairNumber, 2);
});
