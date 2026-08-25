import { describe, expect, it } from "vitest";

import {
  applicationRepairCycleCount,
  automaticApplicationRepairCount,
  previewRepairConsentError,
  previewRepairConsentRequired,
  previewRepairAuthorized,
  rawPreviewRepairError,
} from "./preview-repair-consent";

describe("preview repair consent", () => {
  it("marca a falha sem duplicar marcadores anteriores", () => {
    const marked = previewRepairConsentError("[PREVIEW_CIRCUIT_OPEN] Cannot find module 'express'");
    expect(marked).toBe("[PREVIEW_REPAIR_CONSENT] Cannot find module 'express'");
    expect(previewRepairConsentRequired(marked)).toBe(true);
    expect(rawPreviewRepairError(marked)).toBe("Cannot find module 'express'");
  });

  it("reinicia a contagem do ciclo após o consentimento sem perder o total automático", () => {
    const repair = (createdAt) => ({ createdAt, metadata: { automatic: true, aiInvoked: true, failureClass: "APPLICATION" } });
    const logs = [
      repair("2026-08-24T12:00:00.000Z"),
      repair("2026-08-24T12:01:00.000Z"),
      repair("2026-08-24T12:02:00.000Z"),
      { createdAt: "2026-08-24T12:03:00.000Z", metadata: { automatic: false, aiInvoked: true, failureClass: "APPLICATION", previewRepairConsentGranted: true } },
      repair("2026-08-24T12:04:00.000Z"),
    ];
    expect(automaticApplicationRepairCount(logs)).toBe(4);
    expect(applicationRepairCycleCount(logs)).toBe(2);
  });

  it("mantém o ciclo autorizado até uma nova solicitação de consentimento", () => {
    const required = { createdAt: "2026-08-24T12:00:00.000Z", metadata: { consentRequired: true } };
    const granted = { createdAt: "2026-08-24T12:01:00.000Z", metadata: { previewRepairConsentGranted: true, previewAiRepair: true, aiInvoked: true } };
    const nextRequired = { createdAt: "2026-08-24T12:02:00.000Z", metadata: { consentRequired: true } };

    expect(previewRepairAuthorized([required])).toBe(false);
    expect(previewRepairAuthorized([required, granted])).toBe(true);
    expect(previewRepairAuthorized([required, granted, nextRequired])).toBe(false);
  });
});
