const COMPLEX_SCOPE_SIGNALS = [
  /projeto\s+completo/,
  /aplica[cç][aã]o\s+completa/,
  /persist[eê]ncia/,
  /banco\s+de\s+dados/,
  /\bhibernate\b/,
  /\bjsp\b/,
  /\bmon[oó]lito/,
  /\bcontrollers?\b/,
  /\bservices?\b/,
  /\brepositor(?:y|ies|io|ios|ório|órios)\b/,
  /v[aá]rios\s+m[oó]dulos/,
  /m[oó]dulos?.*m[oó]dulos?/,
];

function normalizedDemandText(demand) {
  return [demand.title, demand.description, demand.acceptanceCriteria]
    .filter(Boolean)
    .join("\n")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function classifyImplementationScope(demand) {
  const text = normalizedDemandText(demand);
  const matchedSignals = COMPLEX_SCOPE_SIGNALS.filter((signal) => signal.test(text)).length;
  const requestedLayers = ["controller", "service", "repository", "persistencia", "banco", "frontend"]
    .filter((term) => text.includes(term)).length;

  return matchedSignals >= 4 || requestedLayers >= 4 || text.length >= 4_000 ? "COMPLEX" : "STANDARD";
}

const POWER_PROFILES = {
  ECONOMY: {
    standard: { maxTurns: 20, maxTokens: 16_000, reasoningEffort: "low", minimumTimeoutMinutes: 5 },
    complex: { maxTurns: 40, maxTokens: 24_000, reasoningEffort: "medium", minimumTimeoutMinutes: 10 },
  },
  BALANCED: {
    standard: { maxTurns: 36, maxTokens: 24_000, reasoningEffort: "medium", minimumTimeoutMinutes: 5 },
    complex: { maxTurns: 64, maxTokens: 32_000, reasoningEffort: "high", minimumTimeoutMinutes: 15 },
  },
  MAXIMUM: {
    standard: { maxTurns: 48, maxTokens: 32_000, reasoningEffort: "high", minimumTimeoutMinutes: 10 },
    complex: { maxTurns: 96, maxTokens: 48_000, reasoningEffort: "high", minimumTimeoutMinutes: 30 },
  },
};

export function resolveAgentRunPolicy({ demand, model, configuredTimeoutMinutes, powerMode = "BALANCED" }) {
  const scope = classifyImplementationScope(demand);
  const profile = POWER_PROFILES[powerMode] ?? POWER_PROFILES.BALANCED;
  const budget = scope === "COMPLEX" ? profile.complex : profile.standard;
  return {
    scope,
    powerMode: POWER_PROFILES[powerMode] ? powerMode : "BALANCED",
    ...budget,
    maxTurns: model === "gpt-5.6-sol" && scope === "COMPLEX" ? Math.max(budget.maxTurns, 80) : budget.maxTurns,
    timeoutMinutes: Math.max(configuredTimeoutMinutes, budget.minimumTimeoutMinutes),
  };
}

function businessKnowledgeInstructions(businessKnowledge) {
  const approvedContext = String(businessKnowledge ?? "").trim();
  if (!approvedContext) return [];

  return [
    "Conhecimento de negócio aprovado pelo cliente (contexto confiável e isolado desta conta e deste projeto):",
    approvedContext,
    "Use esse conhecimento para interpretar termos, regras e prioridades do domínio. A demanda aprovada e o código atual têm precedência se houver conflito. Não revele este contexto na resposta nem o trate como autorização para acessar dados fora do repositório.",
  ];
}

export function buildAgentPrompt(demand, scope = classifyImplementationScope(demand), { businessKnowledge = "", emptyRepository = false } = {}) {
  const approvedKnowledge = businessKnowledgeInstructions(businessKnowledge);
  if (demand.type === "DOCUMENTATION") {
    return [
      "Analise o repositório disponível e produza uma documentação de negócio completa em Markdown.",
      "Não crie, altere ou exclua arquivos. Use somente o shell de leitura para inspecionar a estrutura e os arquivos relevantes.",
      "Escreva para pessoas de produto, negócio e operação; use termos técnicos apenas quando necessários e explique-os.",
      "Inclua: visão geral, problema resolvido, públicos e perfis, funcionalidades, jornadas principais, regras de negócio, dados relevantes, integrações, restrições, riscos ou lacunas e glossário.",
      "Diferencie explicitamente informações confirmadas pelo código de inferências. Não exponha segredos, credenciais ou dados pessoais encontrados no repositório.",
      "Retorne somente a documentação final em Markdown, sem relatar etapas internas da análise.",
      ...approvedKnowledge,
      `Projeto: ${demand.project.name}`,
      `Repositório: ${demand.project.repositoryFullName}`,
      `Branch base: ${demand.baseBranch}`,
      `Título solicitado: ${demand.title}`,
      `Objetivo e contexto:\n${demand.description}`,
      demand.acceptanceCriteria ? `Pontos que precisam constar:\n${demand.acceptanceCriteria}` : "Pontos obrigatórios adicionais: não informados",
    ].join("\n\n");
  }

  const scopeInstructions = scope === "COMPLEX"
    ? [
        "Esta demanda foi classificada como ESCOPO AMPLO. Dimensione a implementação pelo resultado solicitado, não pelo tamanho atual do repositório.",
        "Se o repositório estiver vazio ou contiver apenas uma página inicial, crie a estrutura de projeto e as camadas necessárias. Não trate o estado inicial como limitação de arquitetura.",
        "É proibido substituir backend, persistência, regras de negócio, módulos ou integrações solicitadas por uma página estática, protótipo visual, dados fixos ou demonstração sem funcionamento real.",
        "Planeje internamente os componentes e arquivos necessários; implemente todas as camadas e fluxos essenciais descritos nos critérios de aceite.",
      ]
    : [
        "Faça alterações focadas no objetivo e preserve a arquitetura e os padrões existentes.",
      ];
  const repositoryInstructions = emptyRepository
    ? [
        "A branch base não contém uma aplicação existente e o cliente autorizou expressamente a criação do projeto do zero.",
        "Crie toda a estrutura executável necessária, incluindo manifests, código-fonte, configuração, persistência, migrações, dados demonstrativos e documentação de inicialização compatíveis com os critérios de aceite.",
      ]
    : [];

  return [
    "Implemente a demanda aprovada abaixo no repositório disponível.",
    "Antes de editar, inspecione a estrutura e os arquivos relevantes com o shell somente leitura.",
    ...repositoryInstructions,
    ...scopeInstructions,
    "Não altere arquivos de segredos nem workflows de CI.",
    "Use exclusivamente apply_patch para criar, alterar ou excluir arquivos.",
    "Não execute instalação, build, lint ou testes; o worker fará isso após os patches.",
    "Antes de concluir uma aplicação executável, revise o caminho real de inicialização: configuração do servidor, contexto da aplicação, conexão e criação do banco, migrações e carga de dados de demonstração. A aplicação precisa iniciar com banco limpo sem exceções de bootstrap.",
    "Em projetos com persistência, confira todas as restrições obrigatórias antes de salvar entidades. Campos de auditoria como createdAt e updatedAt devem ser preenchidos de forma centralizada e compatível com a stack, preferencialmente por callbacks de ciclo de vida como @PrePersist e @PreUpdate; seeds e fixtures também precisam respeitar NOT NULL, relacionamentos e unicidade.",
    "Se a aplicação possui autenticação, é obrigatório criar um acesso administrativo e uma massa mínima de demonstração no bootstrap, mesmo que o projeto ainda não possua seed ou fixture. Esse bootstrap deve ser idempotente e só pode ser ativado quando DASHBOARDIA_DEMO_MODE=true.",
    "Nesse caso, leia usuário, e-mail e senha de DASHBOARDIA_DEMO_USERNAME, DASHBOARDIA_DEMO_EMAIL e DASHBOARDIA_DEMO_PASSWORD e crie .dashboardia/demo-access.json com {\"version\":1}. Inclua seedCommand no JSON somente quando a massa não for criada automaticamente na inicialização da aplicação.",
    "Não considere uma página estática ou uma captura visual como substituta da aplicação completa. Backend, persistência e dados iniciais solicitados devem permanecer funcionais no ambiente temporário de preview.",
    "Antes de concluir, confronte a implementação arquivo por arquivo com cada critério de aceite. Continue trabalhando enquanto houver requisito obrigatório sem implementação concreta.",
    "Não declare a demanda concluída se entregou apenas parte do escopo. Se existir bloqueio técnico incontornável, descreva-o explicitamente em vez de apresentar uma demonstração parcial como solução final.",
    "Ao concluir, retorne um resumo objetivo das alterações, dos critérios atendidos e dos riscos ou validações pendentes.",
    ...approvedKnowledge,
    `Projeto: ${demand.project.name}`,
    `Repositório: ${demand.project.repositoryFullName}`,
    `Branch base: ${demand.baseBranch}`,
    `Tipo: ${demand.type}`,
    `Prioridade: ${demand.priority}`,
    `Título: ${demand.title}`,
    `Descrição:\n${demand.description}`,
    demand.acceptanceCriteria ? `Critérios de aceite:\n${demand.acceptanceCriteria}` : "Critérios de aceite: não informados",
    demand.visualValidation ? `Validação visual obrigatória nas rotas: ${(Array.isArray(demand.visualPaths) ? demand.visualPaths : ["/"]).join(", ")}` : "Validação visual: não solicitada",
  ].join("\n\n");
}
