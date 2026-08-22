import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS,
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
  assert.equal(classifyPreviewFailure("falha desconhecida sem evidência causal"), "UNKNOWN");
});

test("assinatura ignora o id dinâmico do diretório de preview", () => {
  const first = "tar (child): /var/lib/dashboardia-previews/work/cmt4un8sk001lp42b252x72hh/source.tar.gz: Cannot open";
  const second = "tar (child): /var/lib/dashboardia-previews/work/cmt999999999999999999999/source.tar.gz: Cannot open";
  assert.equal(normalizePreviewFailure(first), normalizePreviewFailure(second));
  assert.equal(previewFailureSignature(first), previewFailureSignature(second));
});

test("correção automática preserva o contador de tentativas da execução", () => {
  const data = automaticPreviewCorrectionRequeueData({ now: new Date("2026-08-22T18:00:00-03:00"), timeoutMinutes: 30 });
  assert.equal(Object.hasOwn(data, "attempts"), false);
  assert.equal(data.status, "QUEUED");
  assert.equal(data.stage, "IMPLEMENTATION");
  assert.equal(MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS, 3);
});
