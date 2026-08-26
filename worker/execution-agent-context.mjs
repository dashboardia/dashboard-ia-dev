export const MAX_EXECUTION_CONTEXT_CHARACTERS = 48_000;
export const MAX_CLIENT_MESSAGES_IN_CONTEXT = 6;
export const MAX_AGENT_MESSAGES_IN_CONTEXT = 4;

const AUTOMATIC_PREVIEW_REPAIR_PREFIXES = [
  "## Correção automática do ambiente",
  "Analise e tente corrigir a falha do ambiente navegável",
];

export function isAutomaticPreviewRepairMessage(message) {
  if (message?.role !== "USER") return false;
  const content = String(message?.content ?? "").trim();
  if (content.startsWith(AUTOMATIC_PREVIEW_REPAIR_PREFIXES[1])) return true;
  return !message?.authorId && content.startsWith(AUTOMATIC_PREVIEW_REPAIR_PREFIXES[0]);
}

function compactContent(content, limit, preserveTail = false) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= limit) return normalized;
  const marker = "\n\n… conteúdo anterior compactado …\n\n";
  if (preserveTail) return `${marker}${normalized.slice(-(limit - marker.length))}`;
  const headLength = Math.floor((limit - marker.length) * 0.7);
  const tailLength = limit - marker.length - headLength;
  return `${normalized.slice(0, headLength)}${marker}${normalized.slice(-tailLength)}`;
}

function contextCandidate(message, counters) {
  if (isAutomaticPreviewRepairMessage(message)) {
    if (counters.previewRepair >= 1) return null;
    counters.previewRepair += 1;
    return {
      label: "Falha mais recente do ambiente",
      content: compactContent(message.content, 8_000, true),
      attachments: [],
    };
  }

  if (message?.role === "USER" && message?.authorId) {
    if (counters.client >= MAX_CLIENT_MESSAGES_IN_CONTEXT) return null;
    counters.client += 1;
    return {
      label: "Cliente",
      content: compactContent(message.content, 6_000),
      attachments: Array.isArray(message.attachments) ? message.attachments.map((attachment) => attachment.name).filter(Boolean) : [],
    };
  }

  if (message?.role === "AGENT") {
    if (counters.agent >= MAX_AGENT_MESSAGES_IN_CONTEXT) return null;
    counters.agent += 1;
    return {
      label: "Resumo anterior do agente",
      content: compactContent(message.content, 3_000),
      attachments: [],
    };
  }

  return null;
}

export function buildExecutionAgentContext(messages = [], { maxCharacters = MAX_EXECUTION_CONTEXT_CHARACTERS } = {}) {
  const ordered = Array.isArray(messages) ? messages : [];
  const counters = { client: 0, agent: 0, previewRepair: 0 };
  const selectedNewestFirst = [];
  let remaining = Math.max(1, Number(maxCharacters) || MAX_EXECUTION_CONTEXT_CHARACTERS);

  for (let index = ordered.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const candidate = contextCandidate(ordered[index], counters);
    if (!candidate?.content) continue;
    const attachmentLine = candidate.attachments.length ? `\nAnexos: ${candidate.attachments.join(", ")}` : "";
    const block = `${candidate.label}: ${candidate.content}${attachmentLine}`;
    if (block.length > remaining) {
      if (!selectedNewestFirst.length) selectedNewestFirst.push(compactContent(block, remaining, true));
      break;
    }
    selectedNewestFirst.push(block);
    remaining -= block.length + 2;
  }

  const text = selectedNewestFirst.reverse().join("\n\n");
  return {
    text,
    characters: text.length,
    includedMessages: selectedNewestFirst.length,
    omittedMessages: Math.max(0, ordered.length - selectedNewestFirst.length),
  };
}
