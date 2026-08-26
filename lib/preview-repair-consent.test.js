import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationRepairCycleCount,
  automaticApplicationRepairCount,
  pendingPreviewRepairConsent,
  previewRepairConsentError,
  previewRepairConsentRequired,
  previewRepairAuthorized,
  rawPreviewRepairError,
  synchronizedPreviewRepairError,
} from "./preview-repair-consent.js";

test("marca a falha sem duplicar marcadores anteriores", () => {
  const marked = previewRepairConsentError("[PREVIEW_CIRCUIT_OPEN] Cannot find module 'express'");
  assert.equal(marked, "[PREVIEW_REPAIR_CONSENT] Cannot find module 'express'");
  assert.equal(previewRepairConsentRequired(marked), true);
  assert.equal(rawPreviewRepairError(marked), "Cannot find module 'express'");
});

test("reinicia a contagem do ciclo após o consentimento sem perder o total automático", () => {
  const repair = (createdAt) => ({ createdAt, metadata: { automatic: true, aiInvoked: true, failureClass: "APPLICATION" } });
  const logs = [
    repair("2026-08-24T12:00:00.000Z"),
    repair("2026-08-24T12:01:00.000Z"),
    repair("2026-08-24T12:02:00.000Z"),
    { createdAt: "2026-08-24T12:03:00.000Z", metadata: { automatic: false, aiInvoked: true, failureClass: "APPLICATION", previewRepairConsentGranted: true } },
    repair("2026-08-24T12:04:00.000Z"),
  ];
  assert.equal(automaticApplicationRepairCount(logs), 4);
  assert.equal(applicationRepairCycleCount(logs), 2);
});

test("mantém o ciclo autorizado até uma nova solicitação de consentimento", () => {
  const required = { createdAt: "2026-08-24T12:00:00.000Z", metadata: { consentRequired: true } };
  const granted = { createdAt: "2026-08-24T12:01:00.000Z", metadata: { previewRepairConsentGranted: true, previewAiRepair: true, aiInvoked: true } };
  const nextRequired = { createdAt: "2026-08-24T12:02:00.000Z", metadata: { consentRequired: true } };

  assert.equal(previewRepairAuthorized([required]), false);
  assert.equal(previewRepairAuthorized([required, granted]), true);
  assert.equal(previewRepairAuthorized([required, granted, nextRequired]), false);
});

test("mantém o consentimento local enquanto o host continua reportando a mesma falha", () => {
  const local = "[PREVIEW_REPAIR_CONSENT] [APPLICATION] Cannot find module 'express'";
  const remote = "[APPLICATION] Cannot find module 'express'";
  assert.equal(synchronizedPreviewRepairError(local, remote, "FAILED"), local);
  assert.equal(synchronizedPreviewRepairError(local, null, "READY"), null);
});

test("não solicita consentimento novamente antes da resposta do cliente", () => {
  const signature = "failure-1";
  const required = { createdAt: "2026-08-24T12:00:00.000Z", metadata: { consentRequired: true, failureSignature: signature } };
  const granted = { createdAt: "2026-08-24T12:01:00.000Z", metadata: { previewRepairConsentGranted: true } };
  assert.equal(pendingPreviewRepairConsent([required]), true);
  assert.equal(pendingPreviewRepairConsent([required, granted]), false);
});
