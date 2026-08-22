const ACTIVE_EXECUTION_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);
const TERMINAL_EXECUTION_STATUSES = new Set(["SUCCEEDED", "CANCELLED"]);

export const executionCanonicalStatusLabels = {
  QUEUED: "Na fila",
  PREPARING: "Preparando",
  RUNNING: "IA trabalhando",
  VALIDATING: "Validando",
  WAITING_APPROVAL: "Publicando resultado",
  AWAITING_CLIENT: "Aguardando cliente",
  SUCCEEDED: "Concluída",
  FAILED: "Aguardando correção",
  CANCELLED: "Cancelada",
  STOPPED: "Pausada",
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

function environmentStatusLabel(previewState) {
  const labels = {
    NOT_REQUIRED: null,
    NOT_STARTED: "Ambiente ainda não iniciado",
    STARTING: "Preparando ambiente",
    PREPARING: "Preparando ambiente",
    WAITING_IMPLEMENTATION: "Aguardando nova publicação",
    REPAIRING: "Corrigindo ambiente",
    READY: "Ambiente pronto",
    FAILED: "Ambiente com falha",
    EXPIRED: "Ambiente expirado",
  };
  return labels[previewState] ?? null;
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

  const displayStatus = execution?.cancelRequestedAt && status !== "CANCELLED"
    ? "Cancelamento solicitado"
    : (executionCanonicalStatusLabels[status] ?? status);
  const environmentStatus = softwareExecution ? environmentStatusLabel(previewState) : null;

  let displayTone = "neutral";
  if (execution?.cancelRequestedAt || status === "CANCELLED" || paused) displayTone = "paused";
  else if (status === "FAILED") displayTone = "failed";
  else if (processing) displayTone = "active";
  else if (status === "AWAITING_CLIENT") displayTone = "waiting";
  else if (status === "SUCCEEDED") displayTone = "completed";

  const canPause = !blocked && (processing || awaitingEnvironment);
  const canResume = !blocked && paused;
  const canCancel = !execution?.closedAt && !TERMINAL_EXECUTION_STATUSES.has(status) && !execution?.cancelRequestedAt;

  return { status, displayStatus, displayTone, environmentStatus, previewState, previewReady, awaitingEnvironment, interactionAvailable, canPause, canResume, canCancel };
}
