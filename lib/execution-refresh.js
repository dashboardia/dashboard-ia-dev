export const LIVE_EXECUTION_STATUSES = new Set([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "WAITING_APPROVAL",
]);

const TERMINAL_EXECUTION_STATUSES = new Set(["SUCCEEDED", "CANCELLED"]);

const PREVIEW_STATES_THAT_CAN_ADVANCE = new Set([
  "NOT_READY",
  "PREPARING",
  "EVIDENCE",
  "UNAVAILABLE",
]);

export function isExecutionLive(status, cancelRequested = false) {
  return !cancelRequested && LIVE_EXECUTION_STATUSES.has(status);
}

export function shouldPollExecutionDetail(execution) {
  return Boolean(execution && !execution.closedAt && !TERMINAL_EXECUTION_STATUSES.has(execution.status));
}

export function executionRevision(execution, latest = {}) {
  return [
    execution?.updatedAt,
    execution?.status,
    execution?.stage,
    execution?.branchName,
    execution?.baseSha,
    execution?.headSha,
    execution?.inputTokens,
    execution?.outputTokens,
    execution?.adjustmentCount,
    latest.logId ?? execution?.logs?.at(-1)?.id,
    latest.artifactId ?? execution?.artifacts?.at(-1)?.id,
    latest.messageId ?? execution?.messages?.at(-1)?.id,
    execution?.pullRequest?.updatedAt,
    execution?.creditReservation?.updatedAt,
  ].map((value) => value instanceof Date ? value.toISOString() : String(value ?? "")).join("|");
}

export function isExecutionSettling(execution, now = new Date(), graceMilliseconds = 30_000) {
  if (!execution || isExecutionLive(execution.status, Boolean(execution.cancelRequestedAt))) return false;
  const timestamps = [execution.updatedAt, execution.lastInteractionAt, execution.finishedAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) return false;
  const elapsed = now.getTime() - Math.max(...timestamps);
  return elapsed >= 0 && elapsed < graceMilliseconds;
}

export function shouldPollPreview(previewState, executionStatus) {
  if (!previewState) return LIVE_EXECUTION_STATUSES.has(executionStatus);
  if (!PREVIEW_STATES_THAT_CAN_ADVANCE.has(previewState)) return false;
  // O host de preview termina de construir de forma assíncrona e pode ficar
  // pronto depois de a execução entrar em revisão ou de o PR ser aberto.
  return LIVE_EXECUTION_STATUSES.has(executionStatus)
    || ["NOT_READY", "PREPARING", "EVIDENCE"].includes(previewState);
}
