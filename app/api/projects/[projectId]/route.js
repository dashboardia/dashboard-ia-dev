import { NextResponse } from "next/server";

import { requireAdmin, requireProjectRole } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { projectUpdateSchema } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { projectId } = await context.params;
    await requireProjectRole(projectId, "VIEWER");
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, image: true, githubLogin: true } } } },
        _count: { select: { demands: true, pullRequests: true } },
        healthChecks: { orderBy: { checkedAt: "desc" }, take: 24 },
      },
    });
    return NextResponse.json({ project });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const user = await requireAdmin();
    const input = projectUpdateSchema.parse(await request.json());
    const project = await db.project.update({ where: { id: projectId }, data: input });
    await db.auditLog.create({
      data: auditData({ actorId: user.id, projectId, action: "project.update", entityType: "Project", entityId: projectId, metadata: input, request }),
    });
    return NextResponse.json({ project });
  } catch (error) {
    return apiError(error);
  }
}
