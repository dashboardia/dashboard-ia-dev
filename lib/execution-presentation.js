import { executionCanonicalStatusLabels, executionControlState } from "./execution-control-state.js";

export const executionStatusLabels = executionCanonicalStatusLabels;

export const executionStageLabels = {
  ANALYSIS: "Análise",
  PREPARATION: "Preparação",
  IMPLEMENTATION: "Implementação",
  VALIDATION: "Validação",
  VISUAL_VALIDATION: "Validação visual",
  PUBLISH: "Publicação",
  DOCUMENTATION: "Documentação",
};

const ACTIVE_EXECUTION_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);

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

  const processing = ACTIVE_EXECUTION_STATUSES.has(execution?.status);
  const correctionQueued = latestIndex(logs, (entry) => entry.scope === "preview" && /retornou à fila para correção|erro foi enviado à ia/i.test(String(entry.message ?? "")));
  const interactionQueued = latestIndex(logs, (entry) => entry.scope !== "preview" && /ajuste|interação/i.test(String(entry.message ?? "")) && /fila|iniciado/i.test(String(entry.message ?? "")));
  const workspaceStart = latestIndex(logs, (entry) => entry.scope === "workspace" && /preparando cópia isolada/i.test(String(entry.message ?? "")));
  const cycleStart = processing ? Math.max(correctionQueued, interactionQueued, workspaceStart) : -1;
  const currentCycle = cycleStart >= 0 ? logs.slice(cycleStart + (logs[cycleStart]?.scope === "preview" ? 1 : 0)) : logs;
  const executionOnly = currentCycle.filter((entry) => entry.scope !== "preview");

  if (processing && cycleStart >= 0 && !executionOnly.length) return [];
  return executionOnly.slice(-5);
}

export function executionLivePresentation(execution) {
  const control = executionControlState(execution);
  const status = execution?.status;

  if (control.creditBlocked) {
    return { tone: "waiting", title: "Aguardando créditos", subtitle: "A IA foi pausada com segurança. Adicione créditos para continuar esta mesma demanda.", icon: "paused" };
  }

  if (execution?.cancelRequestedAt && status !== "CANCELLED") {
    return { tone: "paused", title: "Cancelamento solicitado", subtitle: "A execução da IA está sendo encerrada com segurança.", icon: "paused" };
  }
  if (status === "STOPPED") {
    return { tone: "paused", title: "Execução pausada", subtitle: "O processamento da IA foi preservado e pode ser retomado.", icon: "paused" };
  }
  if (status === "AWAITING_CLIENT") {
    return { tone: "waiting", title: "Aguardando cliente", subtitle: "A IA concluiu esta etapa. O estado do ambiente é acompanhado separadamente abaixo.", icon: "ready" };
  }
  if (status === "SUCCEEDED") {
    return { tone: "completed", title: "Execução concluída", subtitle: "O processamento da IA foi concluído e o histórico foi preservado.", icon: "ready" };
  }
  if (status === "CANCELLED") {
    return { tone: "paused", title: "Execução cancelada", subtitle: "O processamento da IA foi cancelado antes da conclusão.", icon: "paused" };
  }
  if (status === "FAILED") {
    return { tone: "failed", title: "Aguardando correção", subtitle: "A execução da IA encontrou uma falha e pode continuar na mesma execução.", icon: "failed" };
  }
  if (status === "QUEUED") {
    return { tone: "active", title: "IA na fila", subtitle: "A execução aguarda um worker disponível para iniciar.", icon: "running" };
  }
  if (status === "PREPARING") {
    return { tone: "active", title: "Preparando execução", subtitle: "O worker está preparando o repositório e o contexto para a IA.", icon: "running" };
  }
  if (status === "RUNNING") {
    return { tone: "active", title: "IA trabalhando", subtitle: "A IA está analisando e aplicando as alterações desta execução.", icon: "running" };
  }
  if (status === "VALIDATING") {
    return { tone: "active", title: "Validando resultado", subtitle: "A execução da IA está validando as alterações produzidas.", icon: "running" };
  }
  if (status === "WAITING_APPROVAL") {
    return { tone: "active", title: "Finalizando execução", subtitle: "A IA terminou a implementação e o resultado está sendo preparado para publicação.", icon: "running" };
  }

  return { tone: "completed", title: control.displayStatus, subtitle: "Acompanhe as últimas etapas registradas pela execução da IA.", icon: "ready" };
}
