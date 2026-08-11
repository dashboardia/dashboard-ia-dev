import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { AccessDeniedError, requireProjectRole } from "../../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../../lib/api";
import { auditData } from "../../../../../../lib/audit";
import { db } from "../../../../../../lib/db";
import { assertProjectMemberMutationAllowed } from "../../../../../../lib/project-members";
import { projectMemberUpdateSchema } from "../../../../../../lib/validation";

async function getProjectMember(transaction, projectId, memberId) {
  const member = await transaction.projectMember.findUnique({
    where: { id: memberId },
    select: { id: true, projectId: true, userId: true, role: true },
  });
  if (!member || member.projectId !== projectId) throw new AccessDeniedError("Membro não encontrado", 404);
  return member;
}

export async function PATCH(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId, memberId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const input = projectMemberUpdateSchema.parse(await request.json());

    const member = await db.$transaction(async (transaction) => {
      const target = await getProjectMember(transaction, projectId, memberId);
      const managerCount = await transaction.projectMember.count({ where: { projectId, role: "MANAGER" } });
      assertProjectMemberMutationAllowed({ targetRole: target.role, nextRole: input.role, managerCount });
      const updated = await transaction.projectMember.update({ where: { id: memberId }, data: { role: input.role } });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId, action: "project.member.update", entityType: "ProjectMember", entityId: memberId, metadata: { targetUserId: target.userId, previousRole: target.role, role: input.role }, request }),
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ member });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId, memberId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");

    await db.$transaction(async (transaction) => {
      const target = await getProjectMember(transaction, projectId, memberId);
      const managerCount = await transaction.projectMember.count({ where: { projectId, role: "MANAGER" } });
      assertProjectMemberMutationAllowed({ targetRole: target.role, deleting: true, managerCount });
      await transaction.projectMember.delete({ where: { id: memberId } });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId, action: "project.member.remove", entityType: "ProjectMember", entityId: memberId, metadata: { targetUserId: target.userId, role: target.role }, request }),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ removed: true });
  } catch (error) {
    return apiError(error);
  }
}
