import OpenAI from "openai";
import { NextResponse } from "next/server";

import { AccessDeniedError, requireUser } from "../../../../lib/access";
import { attachmentInputItem } from "../../../../lib/attachment-input";
import { validateAttachmentFiles } from "../../../../lib/attachments";
import { db } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { explainError } from "../../../../lib/error-messages";
import { projectAccessWhere } from "../../../../lib/projects";
import { supportReferenceCandidates, wantsHumanSupport } from "../../../../lib/support-context";
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

async function loadOperationalContext(user, question, currentPath) {
  const reference = supportReferenceCandidates(question, currentPath);
  const access = projectAccessWhere(user);
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
  if (!demand) return { text: "Nenhuma demanda acessível foi identificada nesta conversa ou página.", demand: null };
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
    text: JSON.stringify({ demand: { id: demand.id.slice(-10), title: demand.title, status: demand.status, type: demand.type, project: demand.project, updatedAt: demand.updatedAt.toISOString() }, executions }, null, 2),
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
    const humanSupportRequested = wantsHumanSupport(question);
    const fallbackAnswer = humanSupportRequested || matches.length === 0 ? withHumanSupportGuidance(fallback) : fallback;
    if (!env.OPENAI_API_KEY) return NextResponse.json({ answer: fallbackAnswer, source: "faq", demandReference: operationalContext.demand?.id.slice(-10) ?? null });

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

CONTEXTO OPERACIONAL AUTORIZADO
${operationalContext.text}

COMO RESPONDER
- Entenda a intenção usando toda a conversa, não apenas palavras isoladas.
- Responda primeiro à pergunta feita. Não concatene artigos de FAQ nem apresente assuntos não solicitados.
- Para perguntas amplas sobre como a plataforma funciona, explique a jornada completa: projeto → demanda → execução → evidências → Pull Request → ajustes do cliente → créditos. Ambientes Docker são criados separadamente no menu Ambientes.
- Para dúvidas específicas, dê instruções curtas, em ordem, considerando a página atual. Termine com no máximo uma próxima ação útil.
- Quando houver contexto de demanda, use status, execução, branch e erro explicado para diagnosticar. Informe o identificador curto consultado.
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
      return NextResponse.json({ answer, source: "ai", demandReference: operationalContext.demand?.id.slice(-10) ?? null });
    } catch (error) {
      console.error("[support-chat:ai]", error);
      return NextResponse.json({ answer: withHumanSupportGuidance(fallback), source: "faq", demandReference: operationalContext.demand?.id.slice(-10) ?? null });
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
