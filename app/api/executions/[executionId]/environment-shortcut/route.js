import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { executionPreviewState } from "../../../../../lib/execution-control-state";
import { dashboardiaPreviewConfigured, getDashboardiaPreview, persistDashboardiaPreviewState } from "../../../../../lib/preview-host-client";
import { previewWasManuallyStopped } from "../../../../../lib/preview-stop-reason";

export const dynamic = "force-dynamic";

function normalizedActivity(activity) {
  if (!Array.isArray(activity)) return [];
  return activity.slice(-8).map((item, index) => ({
    key: String(item?.key ?? `step-${index}`),
    message: String(item?.message ?? "Atualizando ambiente"),
    status: String(item?.status ?? "RUNNING").toUpperCase(),
    at: item?.at ? String(item.at) : null,
  }));
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
        previewEnvironment: true,
      },
    });
    await requireProjectRole(execution.demand.projectId, "VIEWER");
    const available = execution.demand.type !== "DOCUMENTATION" && Boolean(execution.branchName && execution.headSha);
    if (!available) return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });

    let remotePreview = null;
    let localPreview = execution.previewEnvironment;
    if (localPreview && dashboardiaPreviewConfigured()) {
      try {
        remotePreview = await getDashboardiaPreview(localPreview.externalId ?? localPreview.id);
        localPreview = await persistDashboardiaPreviewState(db, localPreview, remotePreview);
      } catch {
        remotePreview = null;
      }
    }

    const effectivePreview = remotePreview
      ? {
          ...localPreview,
          status: remotePreview.status ?? localPreview?.status,
          url: remotePreview.status === "READY" ? (remotePreview.url ?? localPreview?.url) : null,
          error: remotePreview.error ?? null,
        }
      : localPreview;
    const state = executionPreviewState(execution, effectivePreview);
    const resetActivity = ["WAITING_IMPLEMENTATION", "REPAIRING"].includes(state);

    return NextResponse.json({
      available: true,
      automatic: true,
      state,
      url: state === "READY" ? effectivePreview?.url ?? null : null,
      projectId: execution.demand.projectId,
      branchName: execution.branchName,
      closed: Boolean(execution.closedAt),
      activity: resetActivity ? [] : normalizedActivity(remotePreview?.activity),
      technicalError: state === "FAILED" ? String(effectivePreview?.error ?? "") : null,
      manuallyStopped: state === "EXPIRED" && previewWasManuallyStopped(localPreview?.error),
      updatedAt: remotePreview?.updatedAt ?? localPreview?.updatedAt ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
