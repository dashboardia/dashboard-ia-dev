import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { settleExecutionCredits } from "../../../../../lib/billing";

const IMMEDIATE_CANCELLATION = ["QUEUED", "WAITING_APPROVAL"];
const COOPERATIVE_CANCELLATION = ["PREPARING", "RUNNING", "VALIDATING"];

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { select: { id: true, projectId: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");

    if (![...IMMEDIATE_CANCELLATION, ...COOPERATIVE_CANCELLATION].includes(execution.status)) {
      return NextResponse.json({ error: "Esta execução não pode mais ser cancelada" }, { status: 409 });
    }

    const immediate = IMMEDIATE_CANCELLATION.includes(execution.status);
    const now = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.execution.update({
        where: { id: executionId },
        data: immediate
          ? { status: "CANCELLED", cancelRequestedAt: now, lockedAt: null, lockedBy: null, finishedAt: now }
          : { cancelRequestedAt: now },
      });
      await transaction.demand.update({ where: { id: execution.demand.id }, data: { status: "APPROVED" } });
      if (immediate) await settleExecutionCredits(transaction, { executionId, consumedCredits: 0 });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.cancel",
          entityType: "Execution",
          entityId: executionId,
          metadata: { previousStatus: execution.status, immediate },
          request,
        }),
      });
      await transaction.executionLog.create({
        data: { executionId, scope: "worker", level: "warn", message: immediate ? "Execução cancelada pelo Gestor" : "Cancelamento solicitado pelo Gestor" },
      });
    });

    return NextResponse.json({ cancelled: immediate, cancellationRequested: !immediate }, { status: immediate ? 200 : 202 });
  } catch (error) {
    return apiError(error);
  }
}
