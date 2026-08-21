import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { restoreReleasedExecutionReservation } from "../../../../../lib/execution-resume";
import { assertOperationalAccess } from "../../../../../lib/operational-access";
import { assertPlatformProcessingEnabled } from "../../../../../lib/platform-processing";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { select: { id: true, projectId: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    assertOperationalAccess(user);
    await assertPlatformProcessingEnabled(db);

    if (execution.status !== "STOPPED") {
      return NextResponse.json({ error: "Somente execuções pausadas pelo administrador podem ser retomadas." }, { status: 409 });
    }

    await db.$transaction(async (transaction) => {
      const current = await transaction.execution.findUniqueOrThrow({ where: { id: executionId } });
      if (current.status !== "STOPPED") throw new Error("A execução mudou de estado enquanto era retomada");
      await restoreReleasedExecutionReservation(transaction, executionId);
      await transaction.execution.update({
        where: { id: executionId },
        data: {
          status: "QUEUED",
          stopRequestedAt: null,
          cancelRequestedAt: null,
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
          finishedAt: null,
          attempts: 0,
          error: null,
        },
      });
      await transaction.demand.update({ where: { id: execution.demand.id }, data: { status: "QUEUED" } });
      await transaction.executionLog.create({
        data: { executionId, scope: "worker", level: "info", message: "Execução retomada após a liberação do processamento global." },
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.resume",
          entityType: "Execution",
          entityId: executionId,
          metadata: { previousStatus: execution.status, reason: "admin-platform-pause" },
          request,
        }),
      });
    });

    return NextResponse.json({ resumed: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
