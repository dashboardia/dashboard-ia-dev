import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { queueDemandExecution } from "../../../../../lib/executions";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    if (!env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Configure OPENAI_API_KEY antes de executar" }, { status: 503 });
    }

    const { demandId } = await context.params;
    const demand = await db.demand.findUniqueOrThrow({ where: { id: demandId } });
    const { user } = await requireProjectRole(demand.projectId, "MANAGER");
    if (!["APPROVED", "FAILED"].includes(demand.status)) {
      return NextResponse.json({ error: "A demanda precisa estar aprovada para entrar na fila" }, { status: 409 });
    }

    const { activeExecutionId, execution } = await queueDemandExecution({ demand, requestedById: user.id });
    if (activeExecutionId) {
      return NextResponse.json({ error: "Já existe uma execução ativa", executionId: activeExecutionId }, { status: 409 });
    }

    await db.auditLog.create({
      data: auditData({ actorId: user.id, projectId: demand.projectId, action: "execution.queue", entityType: "Execution", entityId: execution.id, request }),
    });
    return NextResponse.json({ execution }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
