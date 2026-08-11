import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AccessDeniedError } from "./access";

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

  console.error("[api] Erro não tratado", error);
  return NextResponse.json({ error: "Erro interno" }, { status: 500 });
}
