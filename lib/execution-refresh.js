export const LIVE_EXECUTION_STATUSES = new Set([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "WAITING_APPROVAL",
]);

const PREVIEW_STATES_THAT_CAN_ADVANCE = new Set([
  "NOT_READY",
  "PREPARING",
  "EVIDENCE",
  "UNAVAILABLE",
]);

export function isExecutionLive(status, cancelRequested = false) {
  return !cancelRequested && LIVE_EXECUTION_STATUSES.has(status);
}

export function shouldPollPreview(previewState, executionStatus) {
  return LIVE_EXECUTION_STATUSES.has(executionStatus)
    && (!previewState || PREVIEW_STATES_THAT_CAN_ADVANCE.has(previewState));
}
