const ACTIVE_EXECUTION_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);
const TERMINAL_EXECUTION_STATUSES = new Set(["SUCCEEDED", "CANCELLED"]);

export function executionPreviewState(execution, preview = execution?.previewEnvironment ?? null) {
  if (execution?.demand?.type === "DOCUMENTATION") return "NOT_REQUIRED";
  if (!execution?.branchName || !execution?.headSha) return "NOT_STARTED";
  if (!preview) return "STARTING";
  if (preview.status === "READY" && preview.url) return "READY";
  if (["QUEUED", "BUILDING", "DEPLOYING", "STOPPING"].includes(preview.status)) return "PREPARING";
  if (preview.status === "FAILED") return "FAILED";
  if (preview.status === "EXPIRED") return "EXPIRED";
  return "STARTING";
}

export function executionControlState(execution, preview = execution?.previewEnvironment ?? null) {
  const status = execution?.status ?? "UNKNOWN";
  const previewState = executionPreviewState(execution, preview);
  const softwareExecution = execution?.demand?.type !== "DOCUMENTATION";
  const previewReady = !softwareExecution || previewState === "READY";
  const awaitingEnvironment = status === "AWAITING_CLIENT" && softwareExecution && !previewReady;
  const paused = status === "STOPPED";
  const recoverableFailure = status === "FAILED" && Boolean(execution?.error);
  const blocked = Boolean(execution?.closedAt || execution?.cancelRequestedAt);
  const interactionAvailable = !blocked && (
    paused
    || recoverableFailure
    || (status === "AWAITING_CLIENT" && previewReady)
  );

  let displayStatus = status;
  if (execution?.cancelRequestedAt && status !== "CANCELLED") displayStatus = "Cancelamento solicitado";
  else if (paused) displayStatus = "Processos pausados";
  else if (awaitingEnvironment) displayStatus = previewState === "FAILED" ? "Corrigindo ambiente" : "Preparando ambiente";
  else {
    const labels = {
      QUEUED: "Na fila",
      PREPARING: "Preparando",
      RUNNING: "IA trabalhando",
      VALIDATING: "Validando",
      WAITING_APPROVAL: "Publicando resultado",
      AWAITING_CLIENT: "Aguardando você",
      SUCCEEDED: "Concluída",
      FAILED: "Aguardando correção",
      CANCELLED: "Cancelada",
      STOPPED: "Processos pausados",
    };
    displayStatus = labels[status] ?? status;
  }

  const canPause = !blocked && (
    ACTIVE_EXECUTION_STATUSES.has(status)
    || awaitingEnvironment
  );
  const canResume = !blocked && paused;
  const canCancel = !execution?.closedAt && !TERMINAL_EXECUTION_STATUSES.has(status) && !execution?.cancelRequestedAt;

  return {
    status,
    displayStatus,
    previewState,
    previewReady,
    awaitingEnvironment,
    interactionAvailable,
    canPause,
    canResume,
    canCancel,
  };
}
