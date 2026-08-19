import OpenAI from "openai";
import { NextResponse } from "next/server";

import { AccessDeniedError, requireUser } from "../../../../lib/access";
import { env } from "../../../../lib/env";
import { searchSupportArticles, supportArticles } from "../../../../lib/support-knowledge";

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
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8).filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 800) })) : [];
    const question = messages.at(-1)?.content?.trim();
    if (!question) return NextResponse.json({ answer: "Envie uma pergunta sobre o Dashboardia." }, { status: 400 });
    const matches = searchSupportArticles(question, 2);
    if (matches.length && question.split(/\s+/).length <= 6) return NextResponse.json({ answer: matches.map((item) => `${item.title}\n${item.answer}`).join("\n\n"), source: "faq" });
    if (!env.OPENAI_API_KEY) return NextResponse.json({ answer: matches[0]?.answer ?? "Consulte a página Ajuda e FAQ ou fale com o administrador.", source: "faq" });

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: env.SUPPORT_AI_MODEL,
      max_output_tokens: 450,
      instructions: `Você é o assistente consultivo de usabilidade do Dashboardia. Responda no idioma ${body.locale ?? "pt-BR"}, com objetividade, usando exclusivamente a documentação fornecida. Nunca alegue acessar ou solicitar código-fonte, repositórios, arquivos, segredos, tokens, banco de dados ou dados privados de clientes. Não execute ações. Recuse temas alheios ao produto e indique a FAQ. Documentação:\n${supportArticles.map((item) => `- ${item.title}: ${item.answer}`).join("\n")}`,
      input: messages,
    });
    return NextResponse.json({ answer: response.output_text?.trim() || matches[0]?.answer || "Consulte a página Ajuda e FAQ.", source: "ai" });
  } catch (error) {
    console.error("[support-chat]", error);
    return NextResponse.json({ answer: error instanceof AccessDeniedError ? error.message : "O assistente está temporariamente indisponível." }, { status: error instanceof AccessDeniedError ? error.status : 500 });
  }
}
