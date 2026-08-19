const SENSITIVE_PATTERNS = [
  [/(\b(?:[a-z][a-z0-9+.-]*:){1,2}\/\/[^\s:/]+:)[^\s@/]+@/gi, "$1***@"],
  [/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1***"],
  [/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;"']+/gi, "$1***"],
];

function normalizedPreviewError(error) {
  return String(error ?? "").replace(/\r\n/g, "\n").trim();
}

export function previewFailureSummary(error) {
  const technical = normalizedPreviewError(error);
  const requiredField = technical.match(/NULL not allowed for column\s+["'`]?(\w+)/i)?.[1]
    ?? technical.match(/not-null property references a null[^\n]*:\s*[\w.]+\.(\w+)/i)?.[1];

  if (requiredField) {
    return `A aplicação iniciou, mas não conseguiu gravar os dados iniciais porque o campo obrigatório ${requiredField} ficou sem valor. O reparo automático verificará a inicialização dos campos de auditoria sem remover a validação do banco.`;
  }
  if (/não respondeu dentro de|did not respond within|timed out waiting/i.test(technical)) {
    return "O container foi construído, mas a aplicação não respondeu dentro do tempo limite. Verifique a porta, o comando de inicialização e dependências externas.";
  }
  if (/temporary failure in name resolution|lookup .*docker\.io|failed to fetch anonymous token/i.test(technical)) {
    return "O host não conseguiu acessar o registro de imagens durante o build. A falha é de rede e uma nova tentativa pode concluir a publicação.";
  }
  if (/HTTP Status 404|status\s*404|not found/i.test(technical)) {
    return "A aplicação iniciou, mas a rota inicial não foi encontrada. O reparo automático verificará o contexto e a rota principal do preview.";
  }
  return "O ambiente temporário não conseguiu iniciar. Consulte os detalhes técnicos ou execute novamente para permitir uma nova correção automática.";
}

export function previewTechnicalDetails(error, maxLength = 6_000) {
  let technical = normalizedPreviewError(error);
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) technical = technical.replace(pattern, replacement);
  if (!technical) return null;
  return technical.length > maxLength
    ? `… conteúdo anterior omitido …\n${technical.slice(-maxLength)}`
    : technical;
}
