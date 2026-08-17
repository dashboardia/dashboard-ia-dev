import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { getProjectGitHubAccessToken, verifyRepositoryBranch } from "../../../../lib/github";
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
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const input = projectUpdateSchema.parse(await request.json());
    const currentProject = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { repositoryFullName: true, defaultBranch: true, githubInstallationId: true },
    });

    if (input.defaultBranch && input.defaultBranch !== currentProject.defaultBranch) {
      const token = await getProjectGitHubAccessToken(currentProject, user.id);
      await verifyRepositoryBranch(token, currentProject.repositoryFullName, input.defaultBranch);
    }

    const project = await db.$transaction(async (transaction) => {
      const updated = await transaction.project.update({ where: { id: projectId }, data: input });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId, action: "project.update", entityType: "Project", entityId: projectId, metadata: input, request }),
      });
      return updated;
    });
    return NextResponse.json({ project });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    const activeExecution = await db.execution.findFirst({
      where: { demand: { projectId }, status: { in: ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"] } },
      select: { id: true },
    });
    if (activeExecution) {
      return NextResponse.json({ error: "Conclua ou cancele as execuções ativas antes de excluir o projeto" }, { status: 409 });
    }
    await db.$transaction(async (transaction) => {
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId, action: "project.archive", entityType: "Project", entityId: projectId, metadata: { name: project.name }, request }),
      });
      await transaction.project.update({ where: { id: projectId }, data: { status: "ARCHIVED" } });
      await transaction.projectMember.deleteMany({ where: { projectId } });
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
