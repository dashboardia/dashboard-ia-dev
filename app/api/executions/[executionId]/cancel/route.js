import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { settleExecutionCredits } from "../../../../../lib/billing";
import { terminateExecutionPreview } from "../../../../../lib/execution-environment-control";

const IMMEDIATE_CANCELLATION = new Set(["QUEUED", "WAITING_APPROVAL", "AWAITING_CLIENT", "STOPPED", "FAILED"]);
const COOPERATIVE_CANCELLATION = new Set(["PREPARING", "RUNNING", "VALIDATING"]);

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { select: { id: true, projectId: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");

    if (!IMMEDIATE_CANCELLATION.has(execution.status) && !COOPERATIVE_CANCELLATION.has(execution.status)) {
      return NextResponse.json({ error: "Esta execução não pode mais ser cancelada" }, { status: 409 });
    }

    const immediate = IMMEDIATE_CANCELLATION.has(execution.status);
    const now = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.execution.update({
        where: { id: executionId },
        data: immediate
          ? { status: "CANCELLED", cancelRequestedAt: now, stopRequestedAt: null, lockedAt: null, lockedBy: null, finishedAt: now }
          : { cancelRequestedAt: now },
      });
      await transaction.demand.update({ where: { id: execution.demand.id }, data: { status: "APPROVED" } });
      if (immediate && execution.status === "QUEUED") await settleExecutionCredits(transaction, { executionId, consumedCredits: 0 });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.cancel",
          entityType: "Execution",
          entityId: executionId,
          metadata: { previousStatus: execution.status, immediate, environmentTermination: true },
          request,
        }),
      });
      await transaction.executionLog.create({
        data: { executionId, scope: "worker", level: "warn", message: immediate ? "Execução cancelada pelo cliente" : "Cancelamento solicitado pelo cliente" },
      });
    });

    await terminateExecutionPreview(db, executionId);
    return NextResponse.json({ cancelled: immediate, cancellationRequested: !immediate }, { status: immediate ? 200 : 202 });
  } catch (error) {
    return apiError(error);
  }
}
