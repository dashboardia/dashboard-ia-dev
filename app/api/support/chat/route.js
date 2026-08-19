import OpenAI from "openai";
import { NextResponse } from "next/server";

import { AccessDeniedError, requireUser } from "../../../../lib/access";
import { env } from "../../../../lib/env";
import { buildSupportFallback, searchSupportArticles, supportArticles } from "../../../../lib/support-knowledge";

const windows = new Map();

function rateLimited(userId) {
  const now = Date.now();
  const recent = (windows.get(userId) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  windows.set(userId, recent);
  return recent.length > 12;
}

export async function POST(request) {
  try {
    const user = await requireUser();
    if (rateLimited(user.id)) return NextResponse.json({ answer: "Aguarde um minuto antes de enviar novas perguntas." }, { status: 429 });
    const body = await request.json();
    const locale = ["pt-BR", "en", "es"].includes(body.locale) ? body.locale : "pt-BR";
    const currentPath = typeof body.currentPath === "string" && body.currentPath.startsWith("/") ? body.currentPath.slice(0, 160) : "/";
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12).filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 1_200) })) : [];
    const question = messages.at(-1)?.content?.trim();
    if (!question) return NextResponse.json({ answer: "Envie uma pergunta sobre o Dashboardia." }, { status: 400 });
    const matches = searchSupportArticles(question, 4);
    const fallback = buildSupportFallback(question, locale);
    if (!env.OPENAI_API_KEY) return NextResponse.json({ answer: fallback, source: "faq" });

    try {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: env.SUPPORT_AI_MODEL,
        max_output_tokens: 650,
        instructions: `Você é o assistente consultivo de produto do Dashboardia.

CONTEXTO DA SESSÃO
- Idioma obrigatório: ${locale}
- Página atual: ${currentPath}
- Papel do usuário: ${user.globalRole === "ADMIN" ? "administrador" : "usuário de projeto"}

COMO RESPONDER
- Entenda a intenção usando toda a conversa, não apenas palavras isoladas.
- Responda primeiro à pergunta feita. Não concatene artigos de FAQ nem apresente assuntos não solicitados.
- Para perguntas amplas sobre como a plataforma funciona, explique a jornada completa: projeto → demanda → execução → validações → Pull Request/preview → créditos.
- Para dúvidas específicas, dê instruções curtas, em ordem, considerando a página atual. Termine com no máximo uma próxima ação útil.
- Diferencie claramente o que a plataforma faz automaticamente do que depende de GitHub, Worker, Render, Railway ou Asaas.
- Use exclusivamente a documentação abaixo. Se ela não sustentar a resposta, diga que não encontrou essa informação e indique Ajuda e FAQ ou o administrador.
- Nunca diga que acessou código, repositórios, arquivos, segredos, tokens, banco ou dados privados. Não solicite segredos e não execute ações.
- Recuse temas alheios ao produto.

ARTIGOS MAIS RELEVANTES PARA A PERGUNTA
${matches.length ? matches.map((item) => `- ${item.title}: ${item.answer}`).join("\n") : "- Nenhum artigo específico encontrado."}

DOCUMENTAÇÃO COMPLETA
${supportArticles.map((item) => `- ${item.title}: ${item.answer}`).join("\n")}`,
        input: messages,
      });
      return NextResponse.json({ answer: response.output_text?.trim() || fallback, source: "ai" });
    } catch (error) {
      console.error("[support-chat:ai]", error);
      return NextResponse.json({ answer: fallback, source: "faq" });
    }
  } catch (error) {
    console.error("[support-chat]", error);
    return NextResponse.json({ answer: error instanceof AccessDeniedError ? error.message : "O assistente está temporariamente indisponível." }, { status: error instanceof AccessDeniedError ? error.status : 500 });
  }
}
