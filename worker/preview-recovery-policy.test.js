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
  assert.equal(MAX_AUTOMATIC_APPLICATION_REPAIRS, 2);
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

test("faz duas correções de código automaticamente e pede consentimento a partir da terceira", () => {
  const repairLog = { metadata: { automatic: true, aiInvoked: true, failureClass: "APPLICATION" } };
  assert.deepEqual(applicationRepairDecision({ logs: [] }), {
    action: "AUTO_REPAIR",
    automaticRepairCount: 0,
    repairNumber: 1,
    reason: "within-automatic-limit",
  });
  assert.equal(applicationRepairDecision({ logs: [repairLog] }).action, "AUTO_REPAIR");
  assert.equal(applicationRepairDecision({ logs: [repairLog, repairLog] }).action, "REQUEST_CONSENT");
});
