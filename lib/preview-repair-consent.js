export const PREVIEW_REPAIR_CONSENT_PREFIX = "[PREVIEW_REPAIR_CONSENT]";

export function rawPreviewRepairError(error) {
  return String(error ?? "")
    .replace(/^\[(?:PREVIEW_REPAIR_CONSENT|PREVIEW_CIRCUIT_OPEN)\]\s*/i, "")
    .trim();
}

export function automaticApplicationRepairCount(logs = []) {
  return logs.filter((entry) => {
    const metadata = entry?.metadata;
    return metadata
      && typeof metadata === "object"
      && !Array.isArray(metadata)
      && metadata.automatic === true
      && metadata.aiInvoked === true
      && metadata.failureClass === "APPLICATION";
  }).length;
}

export function previewRepairConsentRequired(error) {
  return String(error ?? "").startsWith(PREVIEW_REPAIR_CONSENT_PREFIX);
}

export function previewRepairConsentError(error) {
  return `${PREVIEW_REPAIR_CONSENT_PREFIX} ${rawPreviewRepairError(error)}`;
}
