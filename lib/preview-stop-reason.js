export const MANUAL_PREVIEW_STOP_PREFIX = "[MANUAL_PREVIEW_STOP]";

export function manualPreviewStopError() {
  return `${MANUAL_PREVIEW_STOP_PREFIX} Ambiente encerrado pelo usuário.`;
}

export function previewWasManuallyStopped(error) {
  return String(error ?? "").startsWith(MANUAL_PREVIEW_STOP_PREFIX);
}

export function preserveManualPreviewStop(localError, remoteError, remoteStatus) {
  if (remoteStatus === "EXPIRED" && previewWasManuallyStopped(localError)) return localError;
  return remoteError ?? null;
}
