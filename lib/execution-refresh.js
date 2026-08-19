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
  if (!previewState) return LIVE_EXECUTION_STATUSES.has(executionStatus);
  if (!PREVIEW_STATES_THAT_CAN_ADVANCE.has(previewState)) return false;
  // O host de preview termina de construir de forma assíncrona e pode ficar
  // pronto depois de a execução entrar em revisão ou de o PR ser aberto.
  return LIVE_EXECUTION_STATUSES.has(executionStatus)
    || ["NOT_READY", "PREPARING", "EVIDENCE"].includes(previewState);
}
