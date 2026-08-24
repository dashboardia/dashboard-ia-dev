import { describe, expect, it } from "vitest";

import {
  previewRepairConsentError,
  previewRepairConsentRequired,
  rawPreviewRepairError,
} from "./preview-repair-consent";

describe("preview repair consent", () => {
  it("marca a falha sem duplicar marcadores anteriores", () => {
    const marked = previewRepairConsentError("[PREVIEW_CIRCUIT_OPEN] Cannot find module 'express'");
    expect(marked).toBe("[PREVIEW_REPAIR_CONSENT] Cannot find module 'express'");
    expect(previewRepairConsentRequired(marked)).toBe(true);
    expect(rawPreviewRepairError(marked)).toBe("Cannot find module 'express'");
  });
});
