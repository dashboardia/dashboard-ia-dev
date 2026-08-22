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
  if (execution?.cancelRequestedAt && execution.status !== "CANCELLED") return "Cancelamento solicitado";
  return executionStatusLabels[execution?.status] ?? execution?.status ?? "—";
}

export function executionStageLabel(stage) {
  return executionStageLabels[stage] ?? stage ?? "—";
}

export function executionLivePresentation(execution) {
  const status = execution?.status;
  const cancelRequested = Boolean(execution?.cancelRequestedAt && status !== "CANCELLED");
  if (cancelRequested) {
    return {
      tone: "paused",
      title: "Cancelamento solicitado",
      subtitle: "O processamento está encerrando com segurança.",
      icon: "paused",
    };
  }
  if (status === "STOPPED") {
    return {
      tone: "paused",
      title: "Execução pausada",
      subtitle: "O processamento foi pausado e pode ser retomado na mesma execução.",
      icon: "paused",
    };
  }
  if (status === "AWAITING_CLIENT") {
    return {
      tone: "waiting",
      title: "Aguardando você",
      subtitle: "A IA terminou esta etapa. Revise o resultado, teste o ambiente e peça novos ajustes pelo chat.",
      icon: "ready",
    };
  }
  if (status === "SUCCEEDED") {
    return {
      tone: "completed",
      title: "Execução concluída",
      subtitle: "O cliente concluiu esta execução e o histórico foi preservado.",
      icon: "ready",
    };
  }
  if (status === "CANCELLED") {
    return {
      tone: "paused",
      title: "Execução cancelada",
      subtitle: "Esta execução foi cancelada antes da conclusão.",
      icon: "paused",
    };
  }
  if (status === "FAILED") {
    return {
      tone: "failed",
      title: "Aguardando correção",
      subtitle: "A execução encontrou uma falha, mas o trabalho pode continuar na mesma execução.",
      icon: "failed",
    };
  }
  if (["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(status)) {
    return {
      tone: "active",
      title: status === "QUEUED" ? "Na fila" : status === "VALIDATING" ? "Validando resultado" : status === "WAITING_APPROVAL" ? "Publicando resultado" : "Acompanhamento ao vivo",
      subtitle: "A página recebe novas etapas automaticamente, sem precisar atualizar.",
      icon: "running",
    };
  }
  return {
    tone: "completed",
    title: executionStatusLabel(execution),
    subtitle: "Acompanhe abaixo as últimas etapas registradas.",
    icon: "ready",
  };
}
