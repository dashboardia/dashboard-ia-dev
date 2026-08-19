export const supportArticles = [
  { id: "github", category: "Integrações", title: "Como conectar o GitHub?", answer: "Em Projetos, escolha Conectar projeto e autorize o GitHub App para o repositório. O Dashboardia solicita apenas as permissões necessárias para ler o código e publicar branches e Pull Requests." },
  { id: "project", category: "Projetos", title: "Como conectar ou remover um projeto?", answer: "Use Projetos → Conectar projeto. Para remover, use a lixeira no cartão do projeto. A remoção libera o limite do plano e permite reconectar o mesmo repositório depois." },
  { id: "demand", category: "Demandas", title: "Como criar uma boa demanda?", answer: "Descreva contexto, objetivo, regras de negócio, restrições técnicas e critérios de aceite verificáveis. Use os exemplos exibidos no formulário para orientar o agente." },
  { id: "execution", category: "Execuções", title: "Como acompanhar uma execução?", answer: "Abra Execuções para acompanhar as etapas, consumo de créditos, logs, resumo, commits, validação visual, diff e Pull Request. Execuções interrompidas exigem reprocessamento manual." },
  { id: "credits", category: "Cobrança", title: "Como funcionam os créditos?", answer: "A página Plano e créditos mostra saldo, reservas, consumo total e consumo por demanda. Uma execução só inicia com saldo suficiente e é interrompida antes de ultrapassar o orçamento autorizado." },
  { id: "preview", category: "Execuções", title: "Por que o preview não aparece?", answer: "O preview depende de um ambiente publicado pelo provedor. No Render, habilite Pull Request Previews; no Railway, habilite PR Environments. O Dashboardia sincroniza o endereço automaticamente quando o provedor o disponibiliza." },
  { id: "security", category: "Segurança", title: "Como o código do cliente é protegido?", answer: "Tokens OAuth são criptografados, segredos não são exibidos na interface e o acesso segue permissões por projeto. O assistente de suporte não recebe código, segredos, repositórios nem dados privados dos clientes." },
  { id: "billing", category: "Cobrança", title: "Quando o plano é ativado?", answer: "O plano é ativado após o webhook confirmado do Asaas. Se o pagamento estiver aprovado e o plano não mudar, verifique o log do webhook e o token de autenticação configurado." },
  { id: "worker", category: "Execuções", title: "Uma execução funciona no servidor web de contingência?", answer: "A aplicação web pode operar no servidor de contingência, mas as execuções dependem de um Worker ativo conectado ao mesmo banco. Confira o status do Worker em Configurações." },
];

export function searchSupportArticles(query, limit = 4) {
  const terms = String(query).toLocaleLowerCase("pt-BR").split(/\s+/).filter((term) => term.length > 2);
  if (!terms.length) return supportArticles.slice(0, limit);
  return supportArticles
    .map((article) => ({ article, score: terms.reduce((score, term) => score + (`${article.title} ${article.answer} ${article.category}`.toLocaleLowerCase("pt-BR").includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article }) => article);
}
