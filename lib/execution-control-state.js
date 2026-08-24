const ACTIVE_EXECUTION_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);
const TERMINAL_EXECUTION_STATUSES = new Set(["SUCCEEDED", "CANCELLED"]);
const READY_TIMESTAMP_TOLERANCE_MS = 2_000;

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

function timestampOf(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

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

function previewReadyForCurrentCycle(execution, preview, previewState) {
  if (previewState !== "READY" || !preview?.url) return false;

  const readyAt = timestampOf(preview.readyAt);
  const executionUpdatedAt = timestampOf(execution?.updatedAt);

  // Alguns chamadores antigos não selecionam readyAt. Nesses casos preservamos
  // compatibilidade; quando o campo está disponível, ele define o ciclo atual.
  if (readyAt === null || executionUpdatedAt === null) return true;
  return readyAt + READY_TIMESTAMP_TOLERANCE_MS >= executionUpdatedAt;
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
    EXPIRED: "Ambiente encerrado",
  };
  return labels[previewState] ?? null;
}

export function executionControlState(execution, preview = execution?.previewEnvironment ?? null) {
  const status = execution?.status ?? "UNKNOWN";
  const previewState = executionPreviewState(execution, preview);
  const softwareExecution = execution?.demand?.type !== "DOCUMENTATION";
  const previewReady = !softwareExecution || previewReadyForCurrentCycle(execution, preview, previewState);
  const awaitingEnvironment = status === "AWAITING_CLIENT"
    && softwareExecution
    && ["STARTING", "PREPARING"].includes(previewState);
  const paused = status === "STOPPED";
  const recoverableFailure = status === "FAILED" && Boolean(execution?.error);
  const blocked = Boolean(execution?.closedAt || execution?.cancelRequestedAt);
  const processing = ACTIVE_EXECUTION_STATUSES.has(status);
  // O ambiente navegável é um recurso auxiliar. Uma falha, expiração ou nova
  // publicação nunca deve bloquear a conversa da execução já entregue.
  const interactionAvailable = !blocked && (paused || recoverableFailure || status === "AWAITING_CLIENT");

  const displayStatus = execution?.cancelRequestedAt && status !== "CANCELLED"
    ? "Cancelamento solicitado"
    : (executionCanonicalStatusLabels[status] ?? status);
  const environmentStatus = softwareExecution ? environmentStatusLabel(previewState) : null;

  let displayTone = "neutral";
  if (execution?.cancelRequestedAt || status === "CANCELLED" || paused) displayTone = "paused";
  else if (status === "FAILED") displayTone = "failed";
  else if (processing || awaitingEnvironment) displayTone = "active";
  else if (status === "AWAITING_CLIENT") displayTone = "waiting";
  else if (status === "SUCCEEDED") displayTone = "completed";

  const canPause = !blocked && (processing || awaitingEnvironment);
  const canResume = !blocked && paused;
  const canCancel = !execution?.closedAt && !TERMINAL_EXECUTION_STATUSES.has(status) && !execution?.cancelRequestedAt;
  const canRestartEnvironment = !blocked
    && softwareExecution
    && Boolean(execution?.branchName && execution?.headSha)
    && ["AWAITING_CLIENT", "STOPPED"].includes(status)
    && ["FAILED", "EXPIRED"].includes(previewState);

  return { status, displayStatus, displayTone, environmentStatus, previewState, previewReady, awaitingEnvironment, interactionAvailable, canPause, canResume, canCancel, canRestartEnvironment };
}
