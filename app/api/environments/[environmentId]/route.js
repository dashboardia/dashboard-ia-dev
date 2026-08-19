import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { stopDevEnvironment, syncDevEnvironment } from "../../../../lib/dev-environments";

async function loadEnvironment(environmentId) {
  return db.devEnvironment.findUniqueOrThrow({ where: { id: environmentId }, include: { project: true } });
}

export async function GET(_request, context) {
  try {
    const { environmentId } = await context.params;
    let environment = await loadEnvironment(environmentId);
    await requireProjectRole(environment.projectId, "VIEWER");
    await syncDevEnvironment(db, environment).catch(async (error) => db.devEnvironment.update({
      where: { id: environment.id },
      data: { error: error instanceof Error ? error.message : String(error), lastHeartbeatAt: new Date() },
    }));
    environment = await loadEnvironment(environmentId);
    return NextResponse.json({ environment });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request, context) {
  try {
    assertSameOrigin(request);
    const { environmentId } = await context.params;
    const environment = await loadEnvironment(environmentId);
    const { user } = await requireProjectRole(environment.projectId, "MANAGER");
    const stopped = await stopDevEnvironment(db, environment);
    await db.auditLog.create({ data: auditData({ actorId: user.id, projectId: environment.projectId, action: "environment.stop", entityType: "DevEnvironment", entityId: environment.id, request }) });
    return NextResponse.json({ environment: stopped });
  } catch (error) {
    return apiError(error);
  }
}
