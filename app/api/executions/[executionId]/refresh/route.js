import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { executionRevision } from "../../../../../lib/execution-refresh";

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
    return NextResponse.json({
      revision: executionRevision(execution, {
        logId: execution.logs[0]?.id,
        artifactId: execution.artifacts[0]?.id,
        messageId: execution.messages[0]?.id,
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
