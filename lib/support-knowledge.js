export const supportArticles = [
  { id: "overview", category: "Primeiros passos", title: "Como funciona o Dashboardia?", answer: "O fluxo principal é: conecte um repositório em Projetos, descreva a necessidade em Demandas e autorize uma Execução. O agente trabalha em uma branch isolada, registra etapas e consumo de créditos, executa as validações disponíveis e publica um Pull Request. Depois, você revisa o resumo, o diff, as evidências visuais e o preview publicado antes de aprovar a entrega." },
  { id: "github", category: "Integrações", title: "Como conectar o GitHub?", answer: "Em Projetos, escolha Conectar projeto e autorize o GitHub App para o repositório. O Dashboardia solicita apenas as permissões necessárias para ler o código e publicar branches e Pull Requests." },
  { id: "project", category: "Projetos", title: "Como conectar ou remover um projeto?", answer: "Use Projetos → Conectar projeto. Para remover, use a lixeira no cartão do projeto. A remoção libera o limite do plano e permite reconectar o mesmo repositório depois." },
  { id: "demand", category: "Demandas", title: "Como criar uma boa demanda?", answer: "Descreva contexto, objetivo, regras de negócio, restrições técnicas e critérios de aceite verificáveis. Use os exemplos exibidos no formulário para orientar o agente." },
  { id: "execution", category: "Execuções", title: "Como acompanhar uma execução?", answer: "Abra Execuções para acompanhar as etapas, consumo de créditos, logs, resumo, commits, validação visual, diff e Pull Request. Execuções interrompidas exigem reprocessamento manual." },
  { id: "credits", category: "Cobrança", title: "Como funcionam os créditos?", answer: "A página Plano e créditos mostra saldo, reservas, consumo total e consumo por demanda. Uma execução só inicia com saldo suficiente e é interrompida antes de ultrapassar o orçamento autorizado." },
  { id: "preview", category: "Execuções", title: "Como funciona o preview?", answer: "Quando a execução termina, o Dashboardia envia a branch para um container temporário isolado, gera uma URL navegável e remove o ambiente automaticamente após o prazo configurado. Se o projeto não puder ser iniciado, as evidências visuais permanecem disponíveis para revisão." },
  { id: "security", category: "Segurança", title: "Como o código do cliente é protegido?", answer: "Tokens OAuth são criptografados, segredos não são exibidos na interface e o acesso segue permissões por projeto. O assistente de suporte não recebe código, segredos, repositórios nem dados privados dos clientes." },
  { id: "billing", category: "Cobrança", title: "Quando o plano é ativado?", answer: "O plano é ativado após o webhook confirmado do Asaas. Se o pagamento estiver aprovado e o plano não mudar, verifique o log do webhook e o token de autenticação configurado." },
  { id: "worker", category: "Execuções", title: "Uma execução funciona no servidor web de contingência?", answer: "A aplicação web pode operar no servidor de contingência, mas as execuções dependem de um Worker ativo conectado ao mesmo banco. Confira o status do Worker em Configurações." },
];

const SEARCH_STOP_WORDS = new Set([
  "a", "as", "como", "da", "de", "do", "e", "em", "esta", "esse", "funciona", "funcionam",
  "o", "os", "para", "plataforma", "por", "que", "um", "uma",
]);

const broadQuestionPatterns = [
  /como\s+(?:funciona|usar|utilizar)\s+(?:o\s+|a\s+)?(?:dashboardia|plataforma)/i,
  /(?:cómo|como)\s+(?:funciona|usar|utilizar)\s+(?:el\s+|la\s+)?(?:dashboardia|plataforma)/i,
  /how\s+(?:does\s+)?(?:dashboardia|the\s+platform)\s+work/i,
  /(?:o\s+)?que\s+(?:é|faz)\s+(?:o\s+|a\s+)?(?:dashboardia|plataforma)/i,
  /what\s+(?:is|does)\s+dashboardia/i,
  /(?:visão|explica(?:ção)?)\s+(?:geral|completa)/i,
];

const overviewByLocale = {
  "pt-BR": "O Dashboardia transforma uma necessidade de negócio em uma entrega de código revisável.\n\n1. Conecte o repositório em Projetos.\n2. Crie a demanda com contexto e critérios de aceite.\n3. Autorize a execução e acompanhe etapas, logs e créditos.\n4. Revise o resumo, o diff, as validações e o preview.\n5. Aprove o Pull Request para concluir a entrega.\n\nVocê pode me dizer em qual dessas etapas está para eu orientar o próximo passo.",
  en: "Dashboardia turns a business need into a reviewable code delivery.\n\n1. Connect the repository under Projects.\n2. Create a request with context and acceptance criteria.\n3. Authorize the execution and track stages, logs, and credits.\n4. Review the summary, diff, validations, and preview.\n5. Approve the Pull Request to complete the delivery.\n\nTell me which stage you are at and I will guide your next step.",
  es: "Dashboardia convierte una necesidad de negocio en una entrega de código revisable.\n\n1. Conecta el repositorio en Proyectos.\n2. Crea la solicitud con contexto y criterios de aceptación.\n3. Autoriza la ejecución y sigue las etapas, los registros y los créditos.\n4. Revisa el resumen, el diff, las validaciones y el preview.\n5. Aprueba el Pull Request para completar la entrega.\n\nDime en qué etapa estás y te indicaré el siguiente paso.",
};

const noAnswerByLocale = {
  "pt-BR": "Não encontrei uma orientação específica para essa dúvida. Consulte Ajuda e FAQ ou explique em qual tela e etapa do Dashboardia você está.",
  en: "I could not find specific guidance for that question. Check Help & FAQ or tell me which Dashboardia page and stage you are on.",
  es: "No encontré una orientación específica para esa pregunta. Consulta Ayuda y FAQ o dime en qué página y etapa de Dashboardia estás.",
};

export function isBroadPlatformQuestion(query) {
  const normalized = String(query).trim();
  return broadQuestionPatterns.some((pattern) => pattern.test(normalized));
}

export function buildSupportFallback(query, locale = "pt-BR") {
  const selectedLocale = Object.hasOwn(overviewByLocale, locale) ? locale : "pt-BR";
  if (isBroadPlatformQuestion(query)) return overviewByLocale[selectedLocale];
  const matches = searchSupportArticles(query, 1);
  return matches[0]?.answer ?? noAnswerByLocale[selectedLocale];
}

export function searchSupportArticles(query, limit = 4) {
  const terms = String(query).toLocaleLowerCase("pt-BR").split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2 && !SEARCH_STOP_WORDS.has(term));
  if (!terms.length) return supportArticles.slice(0, limit);
  return supportArticles
    .map((article) => ({ article, score: terms.reduce((score, term) => score + (`${article.title} ${article.answer} ${article.category}`.toLocaleLowerCase("pt-BR").includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article }) => article);
}
