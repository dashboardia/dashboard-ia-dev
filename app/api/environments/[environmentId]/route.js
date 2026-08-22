import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { stopDevEnvironment, syncDevEnvironment } from "../../../../lib/dev-environments";
import { deleteDashboardiaPreview, getDashboardiaPreview, syncDashboardiaPreview } from "../../../../lib/preview-host-client";

async function loadEnvironment(environmentId) {
  const manual = await db.devEnvironment.findUnique({
    where: { id: environmentId },
    include: { project: true, requestedBy: { select: { name: true, githubLogin: true } } },
  });
  if (manual) return { source: "MANUAL", environment: manual, projectId: manual.projectId };

  const automatic = await db.previewEnvironment.findUniqueOrThrow({
    where: { id: environmentId },
    include: {
      execution: {
        select: {
          id: true,
          branchName: true,
          requestedBy: { select: { name: true, githubLogin: true } },
          demand: {
            select: {
              projectId: true,
              baseBranch: true,
              project: { select: { name: true, repositoryFullName: true } },
            },
          },
        },
      },
    },
  });
  return { source: "EXECUTION", environment: automatic, projectId: automatic.execution.demand.projectId };
}

function automaticEnvironmentView(environment, remote = null) {
  const execution = environment.execution;
  const status = remote?.status ?? environment.status;
  return {
    id: environment.id,
    source: "EXECUTION",
    executionId: execution.id,
    projectId: execution.demand.projectId,
    branchName: execution.branchName ?? execution.demand.baseBranch,
    status,
    provider: environment.provider,
    externalId: remote?.id ?? environment.externalId,
    url: status === "READY" ? (remote?.url ?? environment.url) : null,
    runtime: remote?.displayRuntime ?? remote?.runtime ?? environment.runtime,
    imageReference: remote?.imageReference ?? environment.imageReference,
    port: remote?.port ?? environment.port,
    error: remote?.error ?? environment.error,
    requestedAt: environment.requestedAt,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
    startedAt: environment.startedAt,
    readyAt: environment.readyAt,
    expiresAt: environment.expiresAt,
    stoppedAt: environment.stoppedAt,
    lastHeartbeatAt: environment.lastHeartbeatAt,
    creditCost: 0,
    creditCharge: null,
    creditChargedAt: null,
    creditRefundedAt: null,
    adjustments: Array.isArray(remote?.adjustments) ? remote.adjustments : [],
    credentials: remote?.credentials ?? null,
    activity: Array.isArray(remote?.activity) ? remote.activity : [],
    project: {
      name: execution.demand.project.name,
      repositoryFullName: execution.demand.project.repositoryFullName,
    },
    requestedBy: execution.requestedBy,
  };
}

export async function GET(_request, context) {
  try {
    const { environmentId } = await context.params;
    let loaded = await loadEnvironment(environmentId);
    await requireProjectRole(loaded.projectId, "VIEWER");

    if (loaded.source === "MANUAL") {
      await syncDevEnvironment(db, loaded.environment).catch(async (error) => db.devEnvironment.update({
        where: { id: loaded.environment.id },
        data: { error: error instanceof Error ? error.message : String(error), lastHeartbeatAt: new Date() },
      }));
      loaded = await loadEnvironment(environmentId);
      return NextResponse.json({ environment: { ...loaded.environment, source: "MANUAL", executionId: null } });
    }

    await syncDashboardiaPreview(db, loaded.environment).catch(() => null);
    loaded = await loadEnvironment(environmentId);
    const remote = await getDashboardiaPreview(loaded.environment.externalId ?? loaded.environment.id).catch(() => null);
    return NextResponse.json({ environment: automaticEnvironmentView(loaded.environment, remote) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request, context) {
  try {
    assertSameOrigin(request);
    const { environmentId } = await context.params;
    const loaded = await loadEnvironment(environmentId);
    const { user } = await requireProjectRole(loaded.projectId, "MANAGER");

    if (loaded.source === "MANUAL") {
      const stopped = await stopDevEnvironment(db, loaded.environment);
      await db.auditLog.create({ data: auditData({ actorId: user.id, projectId: loaded.projectId, action: "environment.stop", entityType: "DevEnvironment", entityId: loaded.environment.id, request }) });
      return NextResponse.json({ environment: { ...stopped, source: "MANUAL", executionId: null } });
    }

    await deleteDashboardiaPreview(loaded.environment.externalId ?? loaded.environment.id).catch(() => null);
    const stopped = await db.previewEnvironment.update({
      where: { id: loaded.environment.id },
      data: { status: "EXPIRED", url: null, stoppedAt: new Date(), lastHeartbeatAt: new Date() },
      include: {
        execution: {
          select: {
            id: true,
            branchName: true,
            requestedBy: { select: { name: true, githubLogin: true } },
            demand: { select: { projectId: true, baseBranch: true, project: { select: { name: true, repositoryFullName: true } } } },
          },
        },
      },
    });
    await db.auditLog.create({ data: auditData({ actorId: user.id, projectId: loaded.projectId, action: "environment.stop", entityType: "PreviewEnvironment", entityId: loaded.environment.id, metadata: { executionId: loaded.environment.execution.id }, request }) });
    return NextResponse.json({ environment: automaticEnvironmentView(stopped) });
  } catch (error) {
    return apiError(error);
  }
}
