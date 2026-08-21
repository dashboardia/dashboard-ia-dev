import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AccessDeniedError } from "./access";
import { BillingAccessError } from "./billing";
import { mutationRequestAllowed } from "./request-security";

export function assertSameOrigin(request) {
  if (!mutationRequestAllowed(request)) {
    throw new AccessDeniedError("Origem da requisição não autorizada", 403);
  }
}

function externalIntegrationError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/^github: not found$/i.test(message)) {
    return NextResponse.json({ error: "Repositório não encontrado ou sem permissão de acesso" }, { status: 403 });
  }
  if (/github: bad credentials|conta github sem token/i.test(message)) {
    return NextResponse.json({ error: "A conexão com o GitHub expirou. Entre novamente para continuar." }, { status: 401 });
  }
  return null;
}

export function apiError(error) {
  if (error instanceof BillingAccessError) {
    return NextResponse.json({ error: error.message, code: error.code, billingUrl: "/billing" }, { status: error.status });
  }
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
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

  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  }

  const integrationResponse = externalIntegrationError(error);
  if (integrationResponse) return integrationResponse;

  const errorId = randomUUID();
  console.error(`[api:${errorId}] Erro não tratado`, error);
  return NextResponse.json(
    {
      error: "Não foi possível concluir a operação. Tente novamente em instantes.",
      errorId,
    },
    { status: 500 },
  );
}
