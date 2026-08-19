import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({ where: { id: executionId }, include: { demand: true } });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    if (execution.status !== "AWAITING_CLIENT" || execution.closedAt) {
      return NextResponse.json({ error: "A execução não está aguardando conclusão" }, { status: 409 });
    }
    const now = new Date();
    await db.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({ where: { id: executionId, status: "AWAITING_CLIENT", closedAt: null }, data: { status: "SUCCEEDED", closedAt: now, closedReason: "CLIENT_COMPLETED", finishedAt: now } });
      if (updated.count !== 1) throw new Error("A execução mudou de estado enquanto era concluída");
      await transaction.executionMessage.create({ data: { executionId, authorId: user.id, role: "SYSTEM", content: "Execução concluída pelo cliente." } });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "SUCCEEDED" } });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, projectId: execution.demand.projectId, action: "execution.complete", entityType: "Execution", entityId: executionId, request }) });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
