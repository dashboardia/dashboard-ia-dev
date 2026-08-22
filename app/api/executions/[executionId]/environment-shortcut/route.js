import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      select: {
        branchName: true,
        headSha: true,
        demand: { select: { projectId: true, type: true } },
      },
    });
    await requireProjectRole(execution.demand.projectId, "VIEWER");
    const available = execution.demand.type !== "DOCUMENTATION" && Boolean(execution.branchName && execution.headSha);
    return NextResponse.json({
      available,
      projectId: available ? execution.demand.projectId : null,
      branchName: available ? execution.branchName : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
