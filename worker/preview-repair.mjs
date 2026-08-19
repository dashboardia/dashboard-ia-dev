export const MAX_PREVIEW_REPAIR_ATTEMPTS = 3;

export function canRetryPreviewRepair(attempt) {
  return attempt < MAX_PREVIEW_REPAIR_ATTEMPTS;
}

export function describePreviewRepairFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "O agente de reparo encerrou sem informar uma causa técnica";
}

export function buildPreviewRepairPrompt({ technical, demandPrompt, attempt, previousErrors = [] }) {
  const history = previousErrors.length
    ? `Falhas já observadas em tentativas anteriores:\n${previousErrors.map((error, index) => `${index + 1}. ${error}`).join("\n\n")}`
    : "Esta é a primeira tentativa de reparo do ambiente.";

  return [
    `Tentativa ${attempt} de ${MAX_PREVIEW_REPAIR_ATTEMPTS} para reparar o preview navegável.`,
    "A implementação já foi concluída, mas a aplicação falhou ao compilar ou iniciar no container temporário de preview.",
    "Investigue a saída real abaixo e aplique somente as correções necessárias para a aplicação compilar, iniciar e responder pela porta configurada.",
    "Preserve integralmente o escopo aprovado. Corrija também dados de demonstração, migrações ou configuração quando forem a causa da falha.",
    "Identifique a exceção raiz mais interna, não apenas a última linha do stack trace. Em persistência ou bootstrap, inicialize campos obrigatórios de auditoria como createdAt, updatedAt e version na entidade, no ciclo de vida ou no serviço/bootstrap apropriado.",
    "Não repita uma correção já aplicada. Considere o histórico abaixo para avançar até a próxima causa raiz revelada pela reconstrução.",
    "Não mascare a falha, não remova constraints, não torne campos obrigatórios opcionais e não substitua a aplicação por conteúdo estático.",
    "Use exclusivamente apply_patch. Não execute build, instalação, testes, servidor ou Docker; o host de preview fará a validação novamente.",
    history,
    `Saída técnica mais recente do container:\n${technical}`,
    `Demanda original:\n${demandPrompt}`,
  ].join("\n\n");
}
