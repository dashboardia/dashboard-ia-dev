const DEMAND_REFERENCE = /\bdemanda\s*(?:n(?:ú|u)mero|n[º°.]?|#|id)?\s*[:#-]?\s*([a-z0-9_-]{6,})\b/i;

export function supportReferenceCandidates(question, currentPath) {
  const demandPath = String(currentPath || "").match(/^\/demands\/([^/?#]+)/);
  const executionPath = String(currentPath || "").match(/^\/executions\/([^/?#]+)/);
  const mentionedDemand = String(question || "").match(DEMAND_REFERENCE)?.[1] ?? null;
  return {
    demandReference: mentionedDemand ?? demandPath?.[1] ?? null,
    executionId: executionPath?.[1] ?? null,
  };
}

export function wantsHumanSupport(question) {
  return /(?:falar|conversar).{0,20}(?:pessoa|humano|atendente)|(?:suporte|atendimento|atendente|humano|pessoa|abrir|enviar).{0,28}(?:chamado|humano|suporte|atendimento)|(?:chamado|ticket).{0,20}(?:abrir|suporte|humano)/i.test(String(question || ""));
}

export function wantsAccountOverview(question) {
  return /(?:como|qual|quero|mostre|traga|resuma|atualize|vis[aã]o|status|situa[cç][aã]o).{0,45}(?:meus|minhas|projetos?|demandas?|execu[cç][oõ]es?|coisas|trabalhos?|andamento|pend[eê]ncias?)|(?:meus|minhas).{0,35}(?:projetos?|demandas?|execu[cç][oõ]es?|coisas).{0,30}(?:como|status|situa[cç][aã]o|andamento)|o que.{0,25}(?:est[aá]|ficou|segue).{0,25}(?:pendente|andamento)/i.test(String(question || ""));
}
