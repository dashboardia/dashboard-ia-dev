import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { requireAdmin } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { deleteDashboardiaPreview } from "../../../../lib/preview-host-client";
import { assertUserAdministrationAllowed, assertUserDeletionAllowed } from "../../../../lib/user-administration";
import { userAdministrationSchema, userDeletionSchema } from "../../../../lib/validation";
import { deletePrivateObject } from "../../../../lib/visual-storage";

const ACTIVE_EXECUTION_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"];
const ACTIVE_ENVIRONMENT_STATUSES = ["QUEUED", "BUILDING", "DEPLOYING", "STOPPING"];

export async function PATCH(request, context) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const input = userAdministrationSchema.parse(await request.json());
    const user = await db.$transaction(async (transaction) => {
      const target = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, globalRole: true, status: true },
      });
      const nextGlobalRole = input.globalRole ?? target.globalRole;
      const nextStatus = input.status ?? target.status;
      const activeAdminCount = await transaction.user.count({ where: { globalRole: "ADMIN", status: "ACTIVE" } });
      assertUserAdministrationAllowed({ actorId: actor.id, target, nextGlobalRole, nextStatus, activeAdminCount });

      const updated = await transaction.user.update({
        where: { id: userId },
        data: { globalRole: nextGlobalRole, status: nextStatus },
        select: { id: true, globalRole: true, status: true },
      });
      if (nextStatus === "SUSPENDED") {
        await transaction.session.deleteMany({ where: { userId } });
      }
      await transaction.auditLog.create({
        data: auditData({
          actorId: actor.id,
          action: "user.update_access",
          entityType: "User",
          entityId: userId,
          metadata: { before: target, after: updated },
          request,
        }),
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ user });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request, context) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const input = userDeletionSchema.parse(await request.json());
    const target = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, githubLogin: true, globalRole: true, status: true },
    });
    const activeAdminCount = await db.user.count({ where: { globalRole: "ADMIN", status: "ACTIVE" } });
    assertUserDeletionAllowed({ actorId: actor.id, target, activeAdminCount, confirmation: input.confirmation });

    const ownershipWhere = {
      OR: [
        { requestedById: userId },
        { demand: { createdById: userId } },
        { demand: { project: { createdById: userId } } },
      ],
    };
    const [activeExecutions, activeEnvironments] = await Promise.all([
      db.execution.count({ where: { status: { in: ACTIVE_EXECUTION_STATUSES }, ...ownershipWhere } }),
      db.devEnvironment.count({
        where: {
          status: { in: ACTIVE_ENVIRONMENT_STATUSES },
          OR: [{ requestedById: userId }, { project: { createdById: userId } }],
        },
      }),
    ]);
    if (activeExecutions || activeEnvironments) {
      return NextResponse.json({
        error: "Este usuário ainda possui processamento ativo. Cancele as execuções e encerre os ambientes antes de excluir a conta.",
      }, { status: 409 });
    }

    const projects = await db.project.findMany({ where: { createdById: userId }, select: { id: true } });
    const projectIds = projects.map((project) => project.id);
    const demands = await db.demand.findMany({
      where: { OR: [{ createdById: userId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
      select: { id: true },
    });
    const demandIds = demands.map((demand) => demand.id);
    const executions = await db.execution.findMany({
      where: { OR: [{ requestedById: userId }, ...(demandIds.length ? [{ demandId: { in: demandIds } }] : [])] },
      select: { id: true, previewEnvironment: { select: { id: true, externalId: true } } },
    });
    const executionIds = executions.map((execution) => execution.id);
    const [attachments, environments] = await Promise.all([
      db.executionMessageAttachment.findMany({
        where: {
          OR: [
            { message: { authorId: userId } },
            ...(executionIds.length ? [{ message: { executionId: { in: executionIds } } }] : []),
          ],
        },
        select: { storageKey: true },
      }),
      db.devEnvironment.findMany({
        where: { OR: [{ requestedById: userId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
        select: { id: true, externalId: true },
      }),
    ]);

    const result = await db.$transaction(async (transaction) => {
      const deletedMessages = await transaction.executionMessage.deleteMany({ where: { authorId: userId } });
      const deletedEnvironments = await transaction.devEnvironment.deleteMany({
        where: { OR: [{ requestedById: userId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
      });
      const deletedExecutions = await transaction.execution.deleteMany({
        where: { OR: [{ requestedById: userId }, ...(demandIds.length ? [{ demandId: { in: demandIds } }] : [])] },
      });
      const deletedDemands = await transaction.demand.deleteMany({
        where: { OR: [{ createdById: userId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
      });
      const deletedProjects = await transaction.project.deleteMany({ where: { createdById: userId } });
      await transaction.billingAccount.deleteMany({ where: { ownerUserId: userId } });
      await transaction.user.delete({ where: { id: userId } });
      return {
        messages: deletedMessages.count,
        environments: deletedEnvironments.count,
        executions: deletedExecutions.count,
        demands: deletedDemands.count,
        projects: deletedProjects.count,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const remoteIds = [
      ...executions.map((execution) => execution.previewEnvironment?.externalId ?? execution.previewEnvironment?.id).filter(Boolean),
      ...environments.map((environment) => environment.externalId ?? environment.id).filter(Boolean),
    ];
    await Promise.allSettled([
      ...remoteIds.map((remoteId) => deleteDashboardiaPreview(remoteId)),
      ...attachments.map((attachment) => deletePrivateObject(attachment.storageKey)),
    ]);
    await db.auditLog.create({
      data: auditData({
        actorId: actor.id,
        action: "user.delete",
        entityType: "User",
        entityId: userId,
        metadata: { target: { name: target.name, email: target.email, githubLogin: target.githubLogin }, deleted: result },
        request,
      }),
    });

    return NextResponse.json({ deleted: true, summary: result });
  } catch (error) {
    return apiError(error);
  }
}
