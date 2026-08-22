const ACTIVE_EXECUTION_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);
const TERMINAL_EXECUTION_STATUSES = new Set(["SUCCEEDED", "CANCELLED"]);

const DEFAULT_STATUS_LABELS = {
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

export function executionPreviewState(execution, preview = execution?.previewEnvironment ?? null) {
  const status = execution?.status ?? "UNKNOWN";
  const processing = ACTIVE_EXECUTION_STATUSES.has(status);
  if (execution?.demand?.type === "DOCUMENTATION") return "NOT_REQUIRED";
  if (!execution?.branchName || !execution?.headSha) return "NOT_STARTED";
  if (preview?.status === "FAILED" && processing) return "REPAIRING";
  if (processing && ["READY", "EXPIRED"].includes(preview?.status)) return "WAITING_IMPLEMENTATION";
  if (!preview) return processing ? "WAITING_IMPLEMENTATION" : "STARTING";
  if (preview.status === "READY" && preview.url) return "READY";
  if (["QUEUED", "BUILDING", "DEPLOYING", "STOPPING"].includes(preview.status)) return "PREPARING";
  if (preview.status === "FAILED") return "FAILED";
  if (preview.status === "EXPIRED") return "EXPIRED";
  return "STARTING";
}

function processingLabel(status, previewState) {
  if (previewState === "REPAIRING") {
    return {
      QUEUED: "Correção na fila",
      PREPARING: "Preparando correção",
      RUNNING: "IA corrigindo ambiente",
      VALIDATING: "Validando correção",
      WAITING_APPROVAL: "Publicando correção",
    }[status];
  }
  if (previewState === "WAITING_IMPLEMENTATION") {
    return {
      QUEUED: "Ajuste na fila",
      PREPARING: "Preparando ajuste",
      RUNNING: "IA aplicando ajuste",
      VALIDATING: "Validando ajuste",
      WAITING_APPROVAL: "Publicando nova versão",
    }[status];
  }
  return null;
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
  const processing = ACTIVE_EXECUTION_STATUSES.has(status);
  const interactionAvailable = !blocked && (paused || recoverableFailure || (status === "AWAITING_CLIENT" && previewReady));

  let displayStatus;
  if (execution?.cancelRequestedAt && status !== "CANCELLED") displayStatus = "Cancelamento solicitado";
  else if (paused) displayStatus = "Processos pausados";
  else if (processing && processingLabel(status, previewState)) displayStatus = processingLabel(status, previewState);
  else if (awaitingEnvironment && previewState === "FAILED") displayStatus = "Ambiente com falha";
  else if (awaitingEnvironment) displayStatus = "Preparando ambiente";
  else displayStatus = DEFAULT_STATUS_LABELS[status] ?? status;

  let displayTone = "neutral";
  if (execution?.cancelRequestedAt || status === "CANCELLED" || paused) displayTone = "paused";
  else if (status === "FAILED" || (awaitingEnvironment && previewState === "FAILED")) displayTone = "failed";
  else if (processing) displayTone = "active";
  else if (status === "AWAITING_CLIENT" && previewReady) displayTone = "waiting";
  else if (status === "SUCCEEDED") displayTone = "completed";

  const canPause = !blocked && (processing || awaitingEnvironment);
  const canResume = !blocked && paused;
  const canCancel = !execution?.closedAt && !TERMINAL_EXECUTION_STATUSES.has(status) && !execution?.cancelRequestedAt;

  return {
    status,
    displayStatus,
    displayTone,
    previewState,
    previewReady,
    awaitingEnvironment,
    interactionAvailable,
    canPause,
    canResume,
    canCancel,
  };
}
