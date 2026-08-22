import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

const PROCESSING_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING"]);

function previewState(execution) {
  const preview = execution.previewEnvironment;
  if (!preview) return "STARTING";
  if (preview.status === "READY" && preview.url) return "READY";
  if (["QUEUED", "BUILDING", "DEPLOYING", "STOPPING"].includes(preview.status)) return "PREPARING";
  if (preview.status === "FAILED") return PROCESSING_STATUSES.has(execution.status) ? "REPAIRING" : "FAILED";
  if (preview.status === "EXPIRED") return "EXPIRED";
  return "STARTING";
}

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      select: {
        status: true,
        branchName: true,
        headSha: true,
        closedAt: true,
        demand: { select: { projectId: true, type: true } },
        previewEnvironment: { select: { status: true, url: true, error: true, updatedAt: true } },
      },
    });
    await requireProjectRole(execution.demand.projectId, "VIEWER");
    const available = execution.demand.type !== "DOCUMENTATION" && Boolean(execution.branchName && execution.headSha);
    if (!available) {
      return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
    }

    const state = previewState(execution);
    return NextResponse.json({
      available: true,
      automatic: true,
      state,
      url: state === "READY" ? execution.previewEnvironment?.url ?? null : null,
      projectId: execution.demand.projectId,
      branchName: execution.branchName,
      closed: Boolean(execution.closedAt),
      updatedAt: execution.previewEnvironment?.updatedAt ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
