import { executionControlState } from "./execution-control-state.js";

export const executionStatusLabels = {
  QUEUED: "Na fila",
  PREPARING: "Preparando",
  RUNNING: "IA trabalhando",
  VALIDATING: "Validando",
  WAITING_APPROVAL: "Publicando resultado",
  AWAITING_CLIENT: "Aguardando você",
  SUCCEEDED: "Concluída",
  FAILED: "Aguardando correção",
  CANCELLED: "Cancelada",
  STOPPED: "Pausada",
};

export const executionStageLabels = {
  ANALYSIS: "Análise",
  PREPARATION: "Preparação",
  IMPLEMENTATION: "Implementação",
  VALIDATION: "Validação",
  VISUAL_VALIDATION: "Validação visual",
  PUBLISH: "Publicação",
  DOCUMENTATION: "Documentação",
};

export function executionStatusLabel(execution) {
  return executionControlState(execution).displayStatus;
}

export function executionStatusTone(execution) {
  return executionControlState(execution).displayTone;
}

export function executionStageLabel(stage) {
  return executionStageLabels[stage] ?? stage ?? "—";
}

function latestIndex(logs, predicate) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (predicate(logs[index])) return index;
  }
  return -1;
}

export function executionProgressLogs(execution) {
  const logs = Array.isArray(execution?.logs) ? execution.logs : [];
  if (!logs.length) return [];
  const control = executionControlState(execution);
  const processing = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(execution.status);

  if (control.awaitingEnvironment) {
    const previewStart = latestIndex(logs, (entry) => entry.scope === "preview" && /ambiente navegável iniciado automaticamente|publicação automática|ambiente automático/i.test(String(entry.message ?? "")));
    const relevant = previewStart >= 0 ? logs.slice(previewStart) : logs.filter((entry) => entry.scope === "preview");
    return relevant.slice(-5);
  }

  if (processing) {
    const workspaceStart = latestIndex(logs, (entry) => entry.scope === "workspace" && /preparando cópia isolada/i.test(String(entry.message ?? "")));
    const correctionQueued = latestIndex(logs, (entry) => entry.scope === "preview" && /retornou à fila para correção|erro foi enviado à ia/i.test(String(entry.message ?? "")));
    const interactionQueued = latestIndex(logs, (entry) => /ajuste|interação/i.test(String(entry.message ?? "")) && /fila|iniciado/i.test(String(entry.message ?? "")));
    const start = Math.max(workspaceStart, correctionQueued, interactionQueued);
    if (start >= 0) return logs.slice(start).slice(-5);
  }

  return logs.slice(-5);
}

export function executionLivePresentation(execution) {
  const control = executionControlState(execution);
  const status = execution?.status;

  if (execution?.cancelRequestedAt && status !== "CANCELLED") {
    return { tone: "paused", title: "Cancelamento solicitado", subtitle: "O processamento e o ambiente estão sendo encerrados com segurança.", icon: "paused" };
  }
  if (status === "STOPPED") {
    return { tone: "paused", title: "Processos pausados", subtitle: "O trabalho foi preservado. Você pode conversar com a IA ou reexecutar de onde parou.", icon: "paused" };
  }
  if (control.previewState === "REPAIRING" && ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(status)) {
    return { tone: "active", title: control.displayStatus, subtitle: "A falha do ambiente foi detectada. Esta é uma nova tentativa de correção; as etapas abaixo mostram somente o ciclo atual.", icon: "running" };
  }
  if (control.previewState === "WAITING_IMPLEMENTATION" && ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(status)) {
    return { tone: "active", title: control.displayStatus, subtitle: "A nova interação está sendo aplicada. Depois disso, o ambiente será republicado e validado novamente.", icon: "running" };
  }
  if (control.awaitingEnvironment) {
    return {
      tone: control.previewState === "FAILED" ? "failed" : "active",
      title: control.displayStatus,
      subtitle: control.previewState === "FAILED"
        ? "A publicação falhou. A automação continuará tentando encaminhar a correção sem liberar o chat antes da hora."
        : "A implementação já terminou, mas a execução ainda não acabou: o ambiente está sendo construído e validado.",
      icon: control.previewState === "FAILED" ? "failed" : "running",
    };
  }
  if (status === "AWAITING_CLIENT") {
    return { tone: "waiting", title: "Aguardando você", subtitle: "O ambiente está pronto. Teste o resultado e peça novos ajustes pelo chat quando quiser.", icon: "ready" };
  }
  if (status === "SUCCEEDED") {
    return { tone: "completed", title: "Execução concluída", subtitle: "O cliente concluiu esta execução e o histórico foi preservado.", icon: "ready" };
  }
  if (status === "CANCELLED") {
    return { tone: "paused", title: "Execução cancelada", subtitle: "Esta execução foi cancelada antes da conclusão.", icon: "paused" };
  }
  if (status === "FAILED") {
    return { tone: "failed", title: "Aguardando correção", subtitle: "A execução encontrou uma falha, mas o trabalho pode continuar na mesma execução.", icon: "failed" };
  }
  if (["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(status)) {
    return { tone: "active", title: control.displayStatus, subtitle: "A página recebe novas etapas automaticamente, sem precisar atualizar.", icon: "running" };
  }
  return { tone: "completed", title: control.displayStatus, subtitle: "Acompanhe abaixo as últimas etapas registradas.", icon: "ready" };
}
