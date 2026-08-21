import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { AccessDeniedError, getProjectRole, isAtLeastProjectRole, requireUser } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { assertProjectAiModelAccess } from "../../../../lib/billing";
import { db } from "../../../../lib/db";
import { getProjectGitHubAccessToken, verifyRepositoryBranch } from "../../../../lib/github";
import { demandUpdateSchema } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

async function demandWithAccess(demandId, user) {
  const demand = await db.demand.findUniqueOrThrow({
    where: { id: demandId },
    include: {
      project: true,
      createdBy: { select: { id: true, name: true, email: true, image: true } },
      approvedBy: { select: { id: true, name: true, email: true, image: true } },
      executions: { orderBy: { createdAt: "desc" }, include: { pullRequest: true, logs: { orderBy: { createdAt: "desc" }, take: 50 } } },
    },
  });
  const role = await getProjectRole(user, demand.projectId);
  if (!role) throw new AccessDeniedError();
  return { demand, role };
}

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { demandId } = await context.params;
    const { demand } = await demandWithAccess(demandId, user);
    return NextResponse.json({ demand });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request, context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { demandId } = await context.params;
    const { demand, role } = await demandWithAccess(demandId, user);
    const canEdit = demand.createdById === user.id || isAtLeastProjectRole(role, "MANAGER");
    if (!canEdit) throw new AccessDeniedError();
    const input = demandUpdateSchema.parse(await request.json());
    const normalizedInput = input.type === "DOCUMENTATION"
      ? { ...input, visualValidation: false, visualPaths: [] }
      : input;
    if (normalizedInput.aiModel) await assertProjectAiModelAccess(demand.projectId, normalizedInput.aiModel);
    if (normalizedInput.baseBranch) {
      const token = await getProjectGitHubAccessToken(demand.project, user.id);
      await verifyRepositoryBranch(token, demand.project.repositoryFullName, normalizedInput.baseBranch);
    }
    const updated = await db.$transaction(async (transaction) => {
      const current = await transaction.demand.findUniqueOrThrow({ where: { id: demandId }, select: { status: true } });
      if (!["DRAFT", "PENDING_APPROVAL"].includes(current.status)) {
        throw new AccessDeniedError("Esta demanda não pode mais ser editada", 409);
      }
      const result = await transaction.demand.update({
        where: { id: demandId },
        data: { ...normalizedInput, ...(Object.hasOwn(normalizedInput, "acceptanceCriteria") ? { acceptanceCriteria: normalizedInput.acceptanceCriteria || null } : {}) },
      });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId: demand.projectId, action: "demand.update", entityType: "Demand", entityId: demandId, metadata: normalizedInput, request }),
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ demand: updated });
  } catch (error) {
    return apiError(error);
  }
}
