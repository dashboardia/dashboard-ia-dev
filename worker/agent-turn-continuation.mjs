export function isAgentTurnLimitError(error) {
  const name = String(error?.name ?? "");
  const message = error instanceof Error ? error.message : String(error ?? "");
  return name === "MaxTurnsExceededError"
    || /max turns\s*\(\d+\)\s*exceeded/i.test(message)
    || /maximum number of turns/i.test(message);
}

export function maxTurnSegmentsForPolicy(policy = {}) {
  if (Number.isInteger(policy.maxSegments) && policy.maxSegments > 0) return policy.maxSegments;
  if (policy.powerMode === "MAXIMUM") return 4;
  if (policy.scope === "COMPLEX") return 4;
  return 3;
}

export function continuationPrompt(originalPrompt, segment, totalSegments) {
  return [
    originalPrompt,
    "CONTINUAÇÃO AUTOMÁTICA DA MESMA EXECUÇÃO:",
    `A etapa anterior atingiu o limite interno de turnos. Esta é a continuação ${segment}/${totalSegments}.`,
    "As alterações já aplicadas continuam no workspace. Inspecione o estado atual antes de editar e preserve todo o trabalho válido já realizado.",
    "Não recomece o projeto. Conclua somente o que ainda falta para atender integralmente à demanda e aos critérios de aceite.",
  ].join("\n\n");
}
