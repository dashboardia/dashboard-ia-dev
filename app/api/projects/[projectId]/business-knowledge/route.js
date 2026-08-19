import { NextResponse } from "next/server";

import { AccessDeniedError, requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { businessKnowledgeInputSchema } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";

async function getOwnedProject(projectId) {
  const project = await db.project.findFirst({
    where: { id: projectId, status: { not: "ARCHIVED" } },
    select: { id: true, createdById: true },
  });
  if (!project) throw new AccessDeniedError("Projeto não encontrado", 404);
  return project;
}

export async function GET(_request, context) {
  try {
    const { projectId } = await context.params;
    await requireProjectRole(projectId, "MANAGER");
    const project = await getOwnedProject(projectId);
    const entries = await db.businessKnowledge.findMany({
      where: { projectId, ownerUserId: project.createdById },
      include: {
        approvedBy: { select: { id: true, name: true, email: true, githubLogin: true } },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json({ entries });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const project = await getOwnedProject(projectId);
    const input = businessKnowledgeInputSchema.parse(await request.json());

    const entry = await db.$transaction(async (transaction) => {
      const created = await transaction.businessKnowledge.create({
        data: {
          ownerUserId: project.createdById,
          projectId,
          createdById: user.id,
          status: "CANDIDATE",
          source: input.source,
          title: input.title,
          content: input.content,
        },
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId,
          action: "business_knowledge.create",
          entityType: "BusinessKnowledge",
          entityId: created.id,
          metadata: { status: created.status, source: created.source },
          request,
        }),
      });
      return created;
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
