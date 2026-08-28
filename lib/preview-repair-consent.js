export const PREVIEW_REPAIR_CONSENT_PREFIX = "[PREVIEW_REPAIR_CONSENT]";
export const MAX_APPLICATION_REPAIR_ATTEMPTS_PER_CYCLE = 3;
export const MAX_APPLICATION_REPAIR_ATTEMPTS_PER_EXECUTION = MAX_APPLICATION_REPAIR_ATTEMPTS_PER_CYCLE;

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

export function applicationRepairAttemptCount(logs = []) {
  return logs.filter((entry) => {
    const metadata = entry?.metadata;
    return metadata
      && typeof metadata === "object"
      && !Array.isArray(metadata)
      && metadata.aiInvoked === true
      && metadata.previewAiRepair === true
      && (metadata.automatic === true || metadata.previewRepairConsentGranted === true);
  }).length;
}

export function previewRepairLimitReached(logs = []) {
  return applicationRepairCycleCount(logs) >= MAX_APPLICATION_REPAIR_ATTEMPTS_PER_CYCLE;
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

export function synchronizedPreviewRepairError(localError, remoteError, remoteStatus) {
  if (remoteStatus === "FAILED" && previewRepairConsentRequired(localError)) return localError;
  return remoteError ?? null;
}

export function pendingPreviewRepairConsent(logs = [], failureSignature = null) {
  const ordered = [...logs].sort((first, second) => logTime(first) - logTime(second));
  let pending = false;
  for (const entry of ordered) {
    const metadata = entry?.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    if (metadata.previewRepairConsentGranted === true) pending = false;
    if (metadata.consentRequired === true
      && (!failureSignature || metadata.failureSignature === failureSignature)) pending = true;
  }
  return pending;
}
