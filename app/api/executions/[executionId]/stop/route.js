import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { terminateExecutionPreview } from "../../../../../lib/execution-environment-control";

const COOPERATIVE_STOP_STATUSES = new Set(["PREPARING", "RUNNING", "VALIDATING"]);
const IMMEDIATE_STOP_STATUSES = new Set(["QUEUED", "WAITING_APPROVAL", "AWAITING_CLIENT", "FAILED"]);

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { select: { id: true, projectId: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");

    if (execution.status === "STOPPED") {
      return NextResponse.json({ paused: true, alreadyPaused: true });
    }
    if (!COOPERATIVE_STOP_STATUSES.has(execution.status) && !IMMEDIATE_STOP_STATUSES.has(execution.status)) {
      return NextResponse.json({ error: "Esta execução não possui processos que possam ser pausados." }, { status: 409 });
    }

    const immediate = IMMEDIATE_STOP_STATUSES.has(execution.status);
    const now = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.execution.update({
        where: { id: executionId },
        data: immediate
          ? {
              status: "STOPPED",
              stopRequestedAt: now,
              lockedAt: null,
              lockedBy: null,
              finishedAt: now,
              error: null,
            }
          : { stopRequestedAt: now },
      });
      if (immediate) {
        await transaction.demand.update({ where: { id: execution.demand.id }, data: { status: "STOPPED" } });
      }
      await transaction.executionLog.create({
        data: {
          executionId,
          scope: "worker",
          level: "warn",
          message: immediate
            ? "Processos pausados pelo cliente. A execução permanece aberta para interação ou retomada."
            : "Pausa solicitada pelo cliente; o processo atual será interrompido com segurança.",
        },
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.stop.client",
          entityType: "Execution",
          entityId: executionId,
          metadata: { previousStatus: execution.status, immediate },
          request,
        }),
      });
    });

    await terminateExecutionPreview(db, executionId);
    return NextResponse.json({ paused: immediate, pauseRequested: !immediate }, { status: immediate ? 200 : 202 });
  } catch (error) {
    return apiError(error);
  }
}
