import { NextResponse } from "next/server";

import { requireProjectRole, requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { projectAccessWhere } from "../../../lib/projects";
import { demandInputSchema } from "../../../lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const status = url.searchParams.get("status");
    const demands = await db.demand.findMany({
      where: {
        project: projectAccessWhere(user),
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        createdBy: { select: { id: true, name: true, image: true } },
        approvedBy: { select: { id: true, name: true, image: true } },
        _count: { select: { executions: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ demands });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const input = demandInputSchema.parse(await request.json());
    const { user } = await requireProjectRole(input.projectId, "DEVELOPER");
    const demand = await db.$transaction(async (transaction) => {
      const created = await transaction.demand.create({
        data: {
          ...input,
          acceptanceCriteria: input.acceptanceCriteria || null,
          createdById: user.id,
          status: "PENDING_APPROVAL",
        },
        include: { project: { select: { id: true, name: true, slug: true } } },
      });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId: input.projectId, action: "demand.create", entityType: "Demand", entityId: created.id, metadata: { type: created.type, priority: created.priority }, request }),
      });
      return created;
    });
    return NextResponse.json({ demand }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
