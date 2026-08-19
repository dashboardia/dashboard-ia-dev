import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";

function executionRevision(execution) {
  return [
    execution.updatedAt,
    execution.status,
    execution.stage,
    execution.branchName,
    execution.baseSha,
    execution.headSha,
    execution.inputTokens,
    execution.outputTokens,
    execution.adjustmentCount,
    execution.logs[0]?.id,
    execution.artifacts[0]?.id,
    execution.messages[0]?.id,
    execution.pullRequest?.updatedAt,
    execution.creditReservation?.updatedAt,
  ].map((value) => value instanceof Date ? value.toISOString() : String(value ?? "")).join("|");
}

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      select: {
        updatedAt: true,
        status: true,
        stage: true,
        branchName: true,
        baseSha: true,
        headSha: true,
        inputTokens: true,
        outputTokens: true,
        adjustmentCount: true,
        demand: { select: { projectId: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        artifacts: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        pullRequest: { select: { updatedAt: true } },
        creditReservation: { select: { updatedAt: true } },
      },
    });
    await requireProjectRole(execution.demand.projectId, "VIEWER");
    return NextResponse.json({ revision: executionRevision(execution) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
