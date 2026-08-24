import OpenAI from "openai";
import { NextResponse } from "next/server";

import { AccessDeniedError, requireUser } from "../../../../lib/access";
import { attachmentInputItem } from "../../../../lib/attachment-input";
import { validateAttachmentFiles } from "../../../../lib/attachments";
import { db } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { explainError } from "../../../../lib/error-messages";
import { projectAccessWhere } from "../../../../lib/projects";
import { supportReferenceCandidates, wantsAccountOverview, wantsHumanSupport } from "../../../../lib/support-context";
import { buildSupportFallback, searchSupportArticles, supportArticles } from "../../../../lib/support-knowledge";

const windows = new Map();
const SUPPORT_EMAIL = "suportdashboardia@gmail.com";

function withHumanSupportGuidance(answer) {
  return `${answer}\n\nSe preferir atendimento humano, envie um e-mail para ${SUPPORT_EMAIL}. Inclua o número da demanda, uma descrição do problema e os prints relevantes.`;
}

function rateLimited(userId) {
  const now = Date.now();
  const recent = (windows.get(userId) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  windows.set(userId, recent);
  return recent.length > 12;
}

function projectSnapshot(project) {
  const latestDemand = project.demands[0] ?? null;
  const latestExecution = latestDemand?.executions[0] ?? null;
  const latestHealth = project.healthChecks[0] ?? null;
  return {
    id: project.id,
    name: project.name,
    repository: project.repositoryFullName,
    status: project.status,
    productionUrl: project.productionUrl,
    updatedAt: project.updatedAt.toISOString(),
    demandCount: project._count.demands,
    health: latestHealth ? {
      status: latestHealth.status,
      summary: latestHealth.summary,
      checkedAt: latestHealth.checkedAt.toISOString(),
    } : null,
    latestDemand: latestDemand ? {
      id: latestDemand.id,
      title: latestDemand.title,
      status: latestDemand.status,
      updatedAt: latestDemand.updatedAt.toISOString(),
    } : null,
    latestExecution: latestExecution ? {
      id: latestExecution.id,
      status: latestExecution.status,
      stage: latestExecution.stage,
      updatedAt: latestExecution.updatedAt.toISOString(),
      problem: latestExecution.error ? explainError(latestExecution.error) : null,
      preview: latestExecution.previewEnvironment,
      pullRequest: latestExecution.pullRequest,
    } : null,
  };
}

function overviewNavigation(projects) {
  return {
    links: [
      { label: "Ver projetos", href: "/projects" },
      { label: "Ver demandas", href: "/demands" },
      { label: "Ver execuções", href: "/executions" },
    ],
    projects: projects.slice(0, 8).map((project) => ({
      id: project.id,
      name: project.name,
      repository: project.repository,
      status: project.status,
      health: project.health?.status ?? "UNKNOWN",
      demandCount: project.demandCount,
      latestDemand: project.latestDemand ? { title: project.latestDemand.title, status: project.latestDemand.status } : null,
      latestExecution: project.latestExecution ? { status: project.latestExecution.status, stage: project.latestExecution.stage } : null,
      href: `/projects/${encodeURIComponent(project.id)}`,
      demandHref: project.latestDemand ? `/demands/${encodeURIComponent(project.latestDemand.id)}` : null,
      executionHref: project.latestExecution ? `/executions/${encodeURIComponent(project.latestExecution.id)}` : null,
    })),
  };
}

function demandNavigation(demand) {
  const latestExecution = demand.executions[0] ?? null;
  return {
    projects: [],
    links: [
      { label: "Abrir demanda", href: `/demands/${encodeURIComponent(demand.id)}` },
      ...(latestExecution ? [{ label: "Abrir execução", href: `/executions/${encodeURIComponent(latestExecution.id)}` }] : []),
    ],
  };
}

function overviewFallback(projects) {
  if (!projects.length) return "Você ainda não possui projetos conectados. Use o botão Ver projetos para conectar seu primeiro repositório.";
  const lines = projects.slice(0, 8).map((project) => {
    const health = project.health?.status && project.health.status !== "UNKNOWN" ? `saúde ${project.health.status}` : "saúde ainda não verificada";
    const demand = project.latestDemand ? `última demanda: ${project.latestDemand.title} (${project.latestDemand.status})` : "nenhuma demanda criada";
    const execution = project.latestExecution ? `execução ${project.latestExecution.status}` : "sem execução recente";
    return `• ${project.name}: ${project.status}, ${health}, ${demand}, ${execution}.`;
  });
  return `Este é o panorama atual dos seus projetos:\n\n${lines.join("\n")}\n\nUse os cartões abaixo para abrir diretamente o projeto, a demanda ou a execução que deseja acompanhar.`;
}

async function loadOperationalContext(user, question, currentPath) {
  const reference = supportReferenceCandidates(question, currentPath);
  const access = projectAccessWhere(user);
  const projectRecords = await db.project.findMany({
    where: access,
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      repositoryFullName: true,
      status: true,
      productionUrl: true,
      updatedAt: true,
      _count: { select: { demands: true } },
      healthChecks: { orderBy: { checkedAt: "desc" }, take: 1, select: { status: true, summary: true, checkedAt: true } },
      demands: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          executions: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              stage: true,
              error: true,
              updatedAt: true,
              previewEnvironment: { select: { status: true, url: true } },
              pullRequest: { select: { status: true, url: true, externalNumber: true } },
            },
          },
        },
      },
    },
  });
  const projects = projectRecords.map(projectSnapshot);
  let demand = null;
  if (reference.executionId) {
    const execution = await db.execution.findFirst({
      where: { id: reference.executionId, demand: { project: access } },
      select: { demand: { select: { id: true } } },
    });
    if (execution) reference.demandReference = execution.demand.id;
  }
  if (reference.demandReference) {
    demand = await db.demand.findFirst({
      where: {
        project: access,
        OR: [{ id: reference.demandReference }, { id: { endsWith: reference.demandReference } }],
      },
      select: {
        id: true,
        title: true,
        status: true,
        type: true,
        updatedAt: true,
        project: { select: { name: true, repositoryFullName: true, defaultBranch: true } },
        executions: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { id: true, status: true, stage: true, branchName: true, summary: true, error: true, createdAt: true },
        },
      },
    });
  }
  if (!demand) return {
    text: JSON.stringify({ account: { projectCount: projects.length, projects }, selectedDemand: null }, null, 2),
    demand: null,
    projects,
  };
  const executions = demand.executions.map((execution) => ({
    id: execution.id.slice(-10),
    status: execution.status,
    stage: execution.stage,
    branch: execution.branchName,
    summary: execution.summary?.slice(0, 800) ?? null,
    problem: execution.error ? explainError(execution.error) : null,
    createdAt: execution.createdAt.toISOString(),
  }));
  return {
    demand,
    projects,
    text: JSON.stringify({
      account: { projectCount: projects.length, projects },
      selectedDemand: { id: demand.id.slice(-10), title: demand.title, status: demand.status, type: demand.type, project: demand.project, updatedAt: demand.updatedAt.toISOString() },
      selectedDemandExecutions: executions,
    }, null, 2),
  };
}

export async function POST(request) {
  try {
    const user = await requireUser();
    if (rateLimited(user.id)) return NextResponse.json({ answer: "Aguarde um minuto antes de enviar novas perguntas." }, { status: 429 });
    const formData = await request.formData();
    const localeValue = formData.get("locale");
    const currentPathValue = formData.get("currentPath");
    const locale = ["pt-BR", "en", "es"].includes(localeValue) ? localeValue : "pt-BR";
    const currentPath = typeof currentPathValue === "string" && currentPathValue.startsWith("/") ? currentPathValue.slice(0, 160) : "/";
    let messagePayload = [];
    try {
      messagePayload = JSON.parse(String(formData.get("messages") ?? "[]"));
    } catch {
      return NextResponse.json({ answer: "O histórico da conversa é inválido." }, { status: 400 });
    }
    const messages = Array.isArray(messagePayload) ? messagePayload.slice(-12).filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 4_000) })) : [];
    const attachments = await Promise.all(validateAttachmentFiles(formData.getAll("attachments")).map(async (attachment) => ({
      ...attachment,
      data: Buffer.from(await attachment.file.arrayBuffer()),
    })));
    const question = messages.at(-1)?.content?.trim();
    if (!question) return NextResponse.json({ answer: "Envie uma pergunta sobre o Dashboardia." }, { status: 400 });
    const matches = searchSupportArticles(question, 4);
    const fallback = buildSupportFallback(question, locale);
    const operationalContext = await loadOperationalContext(user, question, currentPath);
    const accountOverviewRequested = wantsAccountOverview(question);
    const navigation = accountOverviewRequested
      ? overviewNavigation(operationalContext.projects)
      : operationalContext.demand
        ? demandNavigation(operationalContext.demand)
        : { links: [], projects: [] };
    const humanSupportRequested = wantsHumanSupport(question);
    const baseFallback = accountOverviewRequested ? overviewFallback(operationalContext.projects) : fallback;
    const fallbackAnswer = humanSupportRequested || (!accountOverviewRequested && matches.length === 0) ? withHumanSupportGuidance(baseFallback) : baseFallback;
    if (!env.OPENAI_API_KEY) return NextResponse.json({ answer: fallbackAnswer, source: "faq", demandReference: operationalContext.demand?.id.slice(-10) ?? null, ...navigation });

    try {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: env.SUPPORT_AI_MODEL,
        max_output_tokens: 1_000,
        instructions: `Você é o assistente consultivo de produto do Dashboardia.

CONTEXTO DA SESSÃO
- Idioma obrigatório: ${locale}
- Página atual: ${currentPath}
- Papel do usuário: ${user.globalRole === "ADMIN" ? "administrador" : "usuário de projeto"}
- Arquivos anexados nesta mensagem: ${attachments.map((attachment) => `${attachment.name} (${attachment.mimeType})`).join(", ") || "nenhum"}
- Cliente pediu atendimento humano: ${humanSupportRequested ? "sim" : "não"}
- Cliente pediu panorama da própria conta: ${accountOverviewRequested ? "sim" : "não"}

CONTEXTO OPERACIONAL AUTORIZADO
${operationalContext.text}

COMO RESPONDER
- Entenda a intenção usando toda a conversa, não apenas palavras isoladas.
- Responda primeiro à pergunta feita. Não concatene artigos de FAQ nem apresente assuntos não solicitados.
- Para perguntas amplas sobre como a plataforma funciona, explique a jornada completa: projeto → demanda → execução → evidências → Pull Request → ajustes do cliente → créditos. Ambientes Docker são criados separadamente no menu Ambientes.
- Para dúvidas específicas, dê instruções curtas, em ordem, considerando a página atual. Termine com no máximo uma próxima ação útil.
- Quando houver contexto de demanda, use status, execução, branch e erro explicado para diagnosticar. Informe o identificador curto consultado.
- Quando o cliente pedir como estão os projetos, demandas, execuções, pendências ou "as coisas dele", sintetize todo o CONTEXTO OPERACIONAL AUTORIZADO. Destaque o que exige ação, o que está em andamento e o que está pronto. Não responda com orientação genérica.
- Os cartões e links de navegação serão adicionados pela aplicação. Na resposta, convide o cliente a usar os cartões abaixo, sem inventar URLs.
- Analise imagens e documentos anexados em conjunto com o texto. Não presuma detalhes ilegíveis ou ausentes; diga o que conseguiu observar.
- Diferencie claramente o que a plataforma faz automaticamente do que depende de GitHub, Worker, Render, Railway ou Asaas.
- Use exclusivamente a documentação e o contexto operacional autorizado abaixo. Se eles não sustentarem a resposta, diga que não conseguiu concluir e ofereça atendimento humano.
- Se o cliente pedir atendimento humano, não prolongue o diagnóstico: informe imediatamente que ele pode enviar o chamado para ${SUPPORT_EMAIL}.
- Se não conseguir resolver ou o diagnóstico não for seguro, explique isso com clareza e indique o mesmo e-mail. Oriente incluir o número da demanda, a descrição do problema e os prints relevantes.
- Você pode dizer que consultou o status da demanda exibida no contexto. Nunca alegue acesso ao código, conteúdo do repositório, segredos ou tokens. Não solicite segredos e não execute ações.
- Recuse temas alheios ao produto.

ARTIGOS MAIS RELEVANTES PARA A PERGUNTA
${matches.length ? matches.map((item) => `- ${item.title}: ${item.answer}`).join("\n") : "- Nenhum artigo específico encontrado."}

DOCUMENTAÇÃO COMPLETA
${supportArticles.map((item) => `- ${item.title}: ${item.answer}`).join("\n")}`,
        input: messages.map((message, index) => index === messages.length - 1 && message.role === "user" && attachments.length
          ? { ...message, content: [{ type: "input_text", text: message.content }, ...attachments.map(attachmentInputItem)] }
          : message),
      });
      const aiAnswer = response.output_text?.trim() || fallbackAnswer;
      const answer = humanSupportRequested && !aiAnswer.includes(SUPPORT_EMAIL) ? withHumanSupportGuidance(aiAnswer) : aiAnswer;
      return NextResponse.json({ answer, source: "ai", demandReference: operationalContext.demand?.id.slice(-10) ?? null, ...navigation });
    } catch (error) {
      console.error("[support-chat:ai]", error);
      return NextResponse.json({ answer: withHumanSupportGuidance(baseFallback), source: "faq", demandReference: operationalContext.demand?.id.slice(-10) ?? null, ...navigation });
    }
  } catch (error) {
    console.error("[support-chat]", error);
    const knownStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
    return NextResponse.json(
      { answer: knownStatus ? error.message : `O assistente está temporariamente indisponível. Para atendimento humano, envie um e-mail para ${SUPPORT_EMAIL}.` },
      { status: knownStatus ? error.status : error instanceof AccessDeniedError ? error.status : 500 },
    );
  }
}
