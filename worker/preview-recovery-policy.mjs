import { createHash } from "node:crypto";
import { applicationRepairCycleCount, automaticApplicationRepairCount } from "../lib/preview-repair-consent.js";

export { automaticApplicationRepairCount } from "../lib/preview-repair-consent.js";

export const MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS = 3;
export const MAX_AUTOMATIC_APPLICATION_REPAIRS = 3;
const MINIMUM_CONVERSATION_TIMEOUT_MINUTES = 24 * 60;

const CIRCUIT_PREFIX = "[PREVIEW_CIRCUIT_OPEN]";

const INFRASTRUCTURE_FAILURES = [
  /\[INFRASTRUCTURE\]/i,
  /\[UNSUPPORTED\]/i,
  /source\.tar\.gz/i,
  /gzip:\s*stdin:\s*unexpected end of file/i,
  /unexpected eof in archive/i,
  /tar\s*\(child\).*cannot open/i,
  /tar:\s*child returned status/i,
  /tar:\s*error is not recoverable/i,
  /arquivo do preview (?:ausente|acima do limite)/i,
  /archive.*(?:truncated|corrupt|unexpected eof)/i,
  /temporary failure in name resolution/i,
  /could not translate host name/i,
  /name or service not known/i,
  /eai_again/i,
  /tls handshake timeout/i,
  /too many requests/i,
  /toomanyrequests/i,
  /service unavailable/i,
  /no space left on device/i,
  /enospc/i,
  /cannot connect to the docker daemon/i,
  /connection reset by peer/i,
  /econnreset/i,
  /socket hang up/i,
  /request aborted/i,
  /host de previews reiniciou/i,
];

const RETRYABLE_INFRASTRUCTURE_FAILURES = [
  /source\.tar\.gz/i,
  /gzip:\s*stdin:\s*unexpected end of file/i,
  /unexpected eof in archive/i,
  /tar\s*\(child\).*cannot open/i,
  /tar:\s*child returned status/i,
  /tar:\s*error is not recoverable/i,
  /archive.*(?:truncated|corrupt|unexpected eof)/i,
  /temporary failure in name resolution/i,
  /eai_again/i,
  /tls handshake timeout/i,
  /too many requests/i,
  /toomanyrequests/i,
  /service unavailable/i,
  /no space left on device/i,
  /enospc/i,
  /cannot connect to the docker daemon/i,
  /connection reset by peer/i,
  /econnreset/i,
  /socket hang up/i,
  /request aborted/i,
  /host de previews reiniciou/i,
];

const APPLICATION_FAILURES = [
  /npm err!/i,
  /pnpm[^\n]*(?:err|error)/i,
  /yarn[^\n]*(?:err|error)/i,
  /failed to compile/i,
  /compilation (?:error|failure)/i,
  /build failure/i,
  /error ts\d{4}/i,
  /module not found/i,
  /modulenotfounderror/i,
  /cannot find module/i,
  /syntaxerror/i,
  /referenceerror/i,
  /typeerror/i,
  /maven[^\n]*(?:failure|error)/i,
  /gradle[^\n]*failed/i,
  /address already in use/i,
  /eaddrinuse/i,
  /migration[^\n]*(?:failed|error)/i,
  /constraint[^\n]*(?:failed|violation)/i,
  /relation [^\n]+ does not exist/i,
  /container encerrou antes de ficar pronto/i,
  /container não publicou uma rota navegável/i,
];

function rawFailure(error) {
  return String(error ?? "").replace(/^\[(?:PREVIEW_REPAIR_CONSENT|PREVIEW_CIRCUIT_OPEN|INFRASTRUCTURE|UNSUPPORTED)\]\s*/i, "").trim();
}

export function normalizePreviewFailure(error) {
  return rawFailure(error)
    .replace(/\/var\/lib\/dashboardia-previews\/work\/[^/\s]+/gi, "/var/lib/dashboardia-previews/work/<preview>")
    .replace(/\b(?:cm[a-z0-9]{18,}|[a-f0-9]{32,64})\b/gi, "<id>")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, "<timestamp>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function previewFailureSignature(error) {
  return createHash("sha256").update(normalizePreviewFailure(error)).digest("hex").slice(0, 24);
}

export function classifyPreviewFailure(error) {
  const tagged = String(error ?? "").trim();
  if (/^\[INFRASTRUCTURE\]/i.test(tagged)) return "INFRASTRUCTURE";
  if (/^\[UNSUPPORTED\]/i.test(tagged)) return "UNKNOWN";
  const value = rawFailure(error);
  if (INFRASTRUCTURE_FAILURES.some((pattern) => pattern.test(value))) return "INFRASTRUCTURE";
  if (APPLICATION_FAILURES.some((pattern) => pattern.test(value))) return "APPLICATION";
  return "UNKNOWN";
}

export function isRetryableInfrastructureFailure(error) {
  const value = rawFailure(error);
  return classifyPreviewFailure(value) === "INFRASTRUCTURE"
    && RETRYABLE_INFRASTRUCTURE_FAILURES.some((pattern) => pattern.test(value));
}

export function isPreviewCircuitOpen(error) {
  return String(error ?? "").startsWith(CIRCUIT_PREFIX);
}

export function previewCircuitOpenError(error) {
  return `${CIRCUIT_PREFIX} ${rawFailure(error)}`;
}

export function applicationRepairDecision({ logs = [] } = {}) {
  const automaticRepairCount = automaticApplicationRepairCount(logs);
  const repairCycleCount = applicationRepairCycleCount(logs);
  const automaticRepairLimitReached = repairCycleCount >= MAX_AUTOMATIC_APPLICATION_REPAIRS;
  return {
    action: automaticRepairLimitReached ? "REQUEST_CONSENT" : "AUTO_REPAIR",
    automaticRepairCount,
    repairCycleCount,
    repairNumber: repairCycleCount + 1,
    reason: automaticRepairLimitReached
      ? "automatic-repair-limit"
      : "within-automatic-limit",
  };
}

export function automaticPreviewCorrectionRequeueData({ now = new Date(), timeoutMinutes }) {
  const safeTimeoutMinutes = Math.max(MINIMUM_CONVERSATION_TIMEOUT_MINUTES, Number(timeoutMinutes) || 0);
  return {
    status: "QUEUED",
    stage: "IMPLEMENTATION",
    lockedAt: null,
    lockedBy: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    lastInteractionAt: now,
    conversationExpiresAt: new Date(now.getTime() + safeTimeoutMinutes * 60_000),
    error: null,
  };
}
