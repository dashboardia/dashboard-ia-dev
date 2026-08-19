import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AccessDeniedError } from "./access";
import { BillingAccessError } from "./billing";
import { explainError } from "./error-messages";

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
  const expectedOrigin = `${forwardedProto}://${forwardedHost}`;

  if (origin !== expectedOrigin) {
    throw new AccessDeniedError("Origem da requisição não autorizada", 403);
  }
}

export function apiError(error) {
  if (error instanceof BillingAccessError) {
    return NextResponse.json({ error: error.message, code: error.code, billingUrl: "/billing" }, { status: error.status });
  }
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Dados inválidos",
        fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 422 },
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Este registro já existe" }, { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
    }
  }

  console.error("[api] Erro não tratado", error);
  const rawMessage = error instanceof Error ? error.message : error;
  const explained = explainError(rawMessage);
  const status = /^github: not found$/i.test(String(rawMessage)) ? 403
    : /github: bad credentials|conta github sem token/i.test(String(rawMessage)) ? 401
      : 500;
  return NextResponse.json(
    { error: `${explained.title}. ${explained.action}`, details: explained.technical || "Exceção sem mensagem técnica" },
    { status },
  );
}
