import { NextResponse } from "next/server";

import { AccessDeniedError, requireProjectRole } from "../../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../../lib/api";
import { auditData } from "../../../../../../lib/audit";
import { db } from "../../../../../../lib/db";
import { businessKnowledgeUpdateSchema } from "../../../../../../lib/validation";

async function getEntry(transaction, projectId, knowledgeId) {
  const project = await transaction.project.findFirst({
    where: { id: projectId, status: { not: "ARCHIVED" } },
    select: { createdById: true },
  });
  if (!project) throw new AccessDeniedError("Projeto não encontrado", 404);

  const entry = await transaction.businessKnowledge.findFirst({
    where: { id: knowledgeId, projectId, ownerUserId: project.createdById },
  });
  if (!entry) throw new AccessDeniedError("Conhecimento não encontrado", 404);
  return entry;
}

export async function PATCH(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId, knowledgeId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const input = businessKnowledgeUpdateSchema.parse(await request.json());

    const entry = await db.$transaction(async (transaction) => {
      const current = await getEntry(transaction, projectId, knowledgeId);
      const contentChanged = input.title !== undefined || input.content !== undefined;
      const nextStatus = input.status ?? (contentChanged ? "CANDIDATE" : current.status);
      const approved = nextStatus === "APPROVED";
      const updated = await transaction.businessKnowledge.update({
        where: { id: knowledgeId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          status: nextStatus,
          approvedById: approved ? user.id : null,
          approvedAt: approved ? new Date() : null,
        },
        include: {
          approvedBy: { select: { id: true, name: true, email: true, githubLogin: true } },
        },
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId,
          action: "business_knowledge.update",
          entityType: "BusinessKnowledge",
          entityId: knowledgeId,
          metadata: { previousStatus: current.status, status: nextStatus, contentChanged },
          request,
        }),
      });
      return updated;
    });

    return NextResponse.json({ entry });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId, knowledgeId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");

    await db.$transaction(async (transaction) => {
      const entry = await getEntry(transaction, projectId, knowledgeId);
      await transaction.businessKnowledge.delete({ where: { id: knowledgeId } });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId,
          action: "business_knowledge.remove",
          entityType: "BusinessKnowledge",
          entityId: knowledgeId,
          metadata: { title: entry.title, status: entry.status },
          request,
        }),
      });
    });

    return NextResponse.json({ removed: true });
  } catch (error) {
    return apiError(error);
  }
}
