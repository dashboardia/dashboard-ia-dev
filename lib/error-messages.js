import { redactSensitiveData } from "./redaction.js";

const rules = [
  {
    match: /CREDIT_BUDGET_EXCEEDED|ultrapassou o limite de .*cr[eé]ditos|cr[eé]ditos? dispon[ií]ve(?:l|is) para esta execu[cç][aã]o/i,
    title: "Créditos insuficientes para continuar",
    message: "O processamento foi pausado antes de ultrapassar o saldo disponível.",
    action: "Adicione créditos e continue esta mesma demanda do ponto em que ela parou.",
  },
  {
    match: /429|no credits remaining|insufficient_quota/i,
    title: "Créditos da OpenAI esgotados",
    message: "A execução parou porque a conta da API OpenAI está sem saldo disponível.",
    action: "Adicione créditos na OpenAI Platform e inicie uma nova execução.",
  },
  {
    match: /permission to .* denied|requested url returned error: 403|github: resource not accessible|github: forbidden/i,
    title: "GitHub sem permissão para publicar",
    message: "O repositório não autorizou a criação da branch ou do Pull Request.",
    action: "Autorize o GitHub App do Dashboard IA para este repositório e tente novamente.",
  },
  {
    match: /^github: not found$/i,
    title: "Repositório não autorizado no GitHub",
    message: "O GitHub não permitiu que o Dashboard IA localizasse este repositório privado.",
    action: "Confirme que o GitHub App Dashboard IA Automação foi instalado na conta proprietária e que este repositório foi selecionado.",
  },
  {
    match: /github: bad credentials|conta github sem token de acesso/i,
    title: "Autorização do GitHub inválida",
    message: "A credencial usada para acessar o GitHub expirou ou não está disponível.",
    action: "Reconecte sua conta ou reinstale o GitHub App e tente novamente.",
  },
  {
    match: /remote branch .* not found|branch .* não existe/i,
    title: "Branch não encontrada",
    message: "A branch configurada no projeto ainda não existe no GitHub.",
    action: "Confira a branch padrão ou crie o primeiro commit no repositório.",
  },
  {
    match: /não contém arquivos de um projeto|empty_project_branch|nenhum arquivo de projeto utilizável/i,
    title: "A branch principal ainda não contém o projeto",
    message: "O agente não encontrou código-fonte ou arquivos de configuração na branch escolhida.",
    action: "Faça merge do Pull Request que contém o projeto na branch principal e inicie uma nova execução. Nenhum crédito é cobrado nesta validação.",
  },
  {
    match: /max_output_length.*do not match/i,
    title: "Falha de compatibilidade do agente",
    message: "O worker recebeu limites de saída diferentes durante a execução.",
    action: "Atualize o Dashboard IA e inicie uma nova execução.",
  },
  {
    match: /validação install falhou|npm ci/i,
    title: "Falha ao instalar dependências",
    message: "O comando de instalação configurado para o projeto não terminou corretamente.",
    action: "Confira o comando de instalação nas configurações do projeto e consulte a saída técnica.",
  },
  {
    match: /validação lint falhou/i,
    title: "O lint encontrou problemas",
    message: "A implementação não passou pelas regras de qualidade configuradas no projeto.",
    action: "Abra a saída técnica para identificar os arquivos e regras que falharam.",
  },
  {
    match: /validação test falhou|tests? failed/i,
    title: "Os testes falharam",
    message: "A implementação produziu uma falha na suíte de testes do projeto.",
    action: "Abra a saída técnica para ver os testes afetados antes de tentar novamente.",
  },
  {
    match: /validação build falhou|build failed/i,
    title: "O build falhou",
    message: "O projeto não conseguiu gerar uma versão de produção com as alterações.",
    action: "Abra a saída técnica para localizar o erro de compilação.",
  },
  {
    match: /github app não configurado|projeto sem instalação do github app/i,
    title: "GitHub App não configurado",
    message: "O Dashboard ainda não possui uma instalação autorizada para este projeto.",
    action: "Abra o cadastro do projeto e autorize o acesso no GitHub.",
  },
  {
    match: /armazenamento da validação visual não está configurado/i,
    title: "Bucket visual não configurado",
    message: "O worker não encontrou as credenciais do armazenamento das evidências.",
    action: "Vincule o bucket aos serviços do dashboard e do worker e tente novamente.",
  },
  {
    match: /não possui comando e porta de preview configurados/i,
    title: "Preview visual não configurado",
    message: "A demanda pediu evidências visuais, mas o projeto ainda não informa como iniciar a aplicação.",
    action: "Configure o comando e a porta de preview no projeto e inicie uma nova execução.",
  },
  {
    match: /preview visual não ficou disponível|comando de preview foi encerrado/i,
    title: "Preview da implementação indisponível",
    message: "A aplicação modificada não iniciou corretamente para a captura das telas.",
    action: "Confira o comando de preview do projeto e os detalhes técnicos da execução.",
  },
];

export function explainError(value) {
  const technical = redactSensitiveData(value).trim();
  const rule = rules.find((candidate) => candidate.match.test(technical));
  if (rule) return { title: rule.title, message: rule.message, action: rule.action, technical };
  return {
    title: "Não foi possível concluir a operação",
    message: "O Dashboard encontrou um erro inesperado durante o processamento.",
    action: "Tente novamente. Se o problema continuar, consulte os detalhes técnicos.",
    technical,
  };
}

export function publicErrorMessage(value) {
  const explained = explainError(value);
  return `${explained.title}. ${explained.action}`;
}

export const logScopeLabels = {
  workspace: "Preparação",
  agent: "Implementação",
  install: "Dependências",
  lint: "Qualidade",
  test: "Testes",
  build: "Build",
  validation: "Validação",
  publish: "Publicação",
  visual: "Validação visual",
  worker: "Processamento",
};

export const logLevelLabels = { info: "Informação", warn: "Atenção", error: "Erro" };
