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
      && (metadata.previewAiRepair === true || metadata.failureClass === "APPLICATION");
  }).length;
}

function logTime(entry) {
  const value = entry?.createdAt ? new Date(entry.createdAt).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

export function applicationRepairCycleCount(logs = []) {
  const ordered = [...logs].sort((first, second) => logTime(first) - logTime(second));
  const lastConsentIndex = ordered.findLastIndex((entry) => entry?.metadata?.previewRepairConsentGranted === true);
  return ordered.slice(Math.max(0, lastConsentIndex)).filter((entry) => {
    const metadata = entry?.metadata;
    return metadata
      && typeof metadata === "object"
      && !Array.isArray(metadata)
      && metadata.aiInvoked === true
      && (metadata.previewAiRepair === true || metadata.failureClass === "APPLICATION");
  }).length;
}

export function previewRepairAuthorized(logs = []) {
  const ordered = [...logs].sort((first, second) => logTime(first) - logTime(second));
  const lastGranted = ordered.findLastIndex((entry) => entry?.metadata?.previewRepairConsentGranted === true);
  const lastRequired = ordered.findLastIndex((entry) => entry?.metadata?.consentRequired === true);
  return lastGranted >= 0 && lastGranted > lastRequired;
}

export function previewRepairConsentRequired(error) {
  return String(error ?? "").startsWith(PREVIEW_REPAIR_CONSENT_PREFIX);
}

export function previewRepairConsentError(error) {
  return `${PREVIEW_REPAIR_CONSENT_PREFIX} ${rawPreviewRepairError(error)}`;
}
