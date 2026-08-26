import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { executionControlState } from "../../../../../lib/execution-control-state";
import { syncDashboardiaPreview } from "../../../../../lib/preview-host-client";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      select: {
        id: true,
        status: true,
        stage: true,
        branchName: true,
        headSha: true,
        error: true,
        closedAt: true,
        cancelRequestedAt: true,
        stopRequestedAt: true,
        demand: { select: { projectId: true, type: true } },
        previewEnvironment: true,
      },
    });
    await requireProjectRole(execution.demand.projectId, "VIEWER");

    const preview = await syncDashboardiaPreview(db, execution.previewEnvironment, { force: true })
      .catch(() => execution.previewEnvironment);
    const control = executionControlState(execution, preview);

    return NextResponse.json({
      executionId,
      ...control,
      environmentUrl: control.previewReady ? preview?.url ?? null : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
