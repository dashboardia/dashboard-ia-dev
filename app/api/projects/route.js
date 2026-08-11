import { NextResponse } from "next/server";

import { requireAdmin, requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { createUniqueProjectSlug, projectAccessWhere } from "../../../lib/projects";
import { projectInputSchema } from "../../../lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await db.project.findMany({
      where: { ...projectAccessWhere(user), status: { not: "ARCHIVED" } },
      include: {
        members: { select: { userId: true, role: true } },
        _count: { select: { demands: true } },
        healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ projects });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = projectInputSchema.parse(await request.json());
    const slug = await createUniqueProjectSlug(input.name);

    const project = await db.$transaction(async (transaction) => {
      const created = await transaction.project.create({
        data: {
          ...input,
          slug,
          repositoryFullName: input.repositoryFullName.toLowerCase(),
          createdById: user.id,
          members: { create: { userId: user.id, role: "MANAGER" } },
        },
      });

      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: created.id,
          action: "project.create",
          entityType: "Project",
          entityId: created.id,
          metadata: { repositoryFullName: created.repositoryFullName },
          request,
        }),
      });

      return created;
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
