import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { findGitHubRepositoryInstallation, getGitHubAccessToken, getGitHubInstallationToken, verifyRepositoryAccess, verifyRepositoryBranch } from "../../../lib/github";
import { createUniqueProjectSlug, projectAccessWhere } from "../../../lib/projects";
import { configureProjectGitHubWebhook } from "../../../lib/project-webhooks";
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
    const user = await requireUser();
    const input = projectInputSchema.parse(await request.json());
    const repositoryFullName = input.repositoryFullName.toLowerCase();
    const repositoryInstallation = input.githubInstallationId
      ? { id: input.githubInstallationId }
      : await findGitHubRepositoryInstallation(repositoryFullName);
    const githubInstallationId = repositoryInstallation?.id ? String(repositoryInstallation.id) : undefined;
    const token = githubInstallationId
      ? await getGitHubInstallationToken(githubInstallationId)
      : await getGitHubAccessToken(user.id);
    const githubRepository = await verifyRepositoryAccess(token, repositoryFullName);
    if (!githubRepository.permissions?.push) {
      return NextResponse.json({ error: "Sua conta GitHub não possui permissão de escrita neste repositório" }, { status: 403 });
    }
    if (githubRepository.size > 0) {
      try {
        await verifyRepositoryBranch(token, input.repositoryFullName.toLowerCase(), input.defaultBranch);
      } catch {
        return NextResponse.json({ error: `A branch ${input.defaultBranch} não existe neste repositório` }, { status: 422 });
      }
    }

    const existingProject = await db.project.findUnique({
      where: {
        provider_repositoryFullName: {
          provider: "GITHUB",
          repositoryFullName: input.repositoryFullName.toLowerCase(),
        },
      },
    });
    if (existingProject) {
      await db.$transaction(async (transaction) => {
        await transaction.project.update({
          where: { id: existingProject.id },
          data: { status: "ACTIVE", githubInstallationId: githubInstallationId ?? existingProject.githubInstallationId },
        });
        await transaction.projectMember.upsert({
          where: { projectId_userId: { projectId: existingProject.id, userId: user.id } },
          update: { role: "MANAGER" },
          create: { projectId: existingProject.id, userId: user.id, role: "MANAGER" },
        });
        await transaction.auditLog.create({
          data: auditData({
            actorId: user.id,
            projectId: existingProject.id,
            action: "project.connect",
            entityType: "Project",
            entityId: existingProject.id,
            metadata: { repositoryFullName: existingProject.repositoryFullName },
            request,
          }),
        });
      });
      const connectedProject = { ...existingProject, status: "ACTIVE", githubInstallationId: githubInstallationId ?? existingProject.githubInstallationId };
      const webhook = await configureProjectGitHubWebhook({ project: connectedProject, userId: user.id });
      return NextResponse.json({ project: connectedProject, webhook });
    }
    const slug = await createUniqueProjectSlug(input.name);

    const project = await db.$transaction(async (transaction) => {
      const created = await transaction.project.create({
        data: {
          ...input,
          slug,
          repositoryFullName: input.repositoryFullName.toLowerCase(),
          repositoryId: String(githubRepository.id),
          githubInstallationId,
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

    const webhook = await configureProjectGitHubWebhook({ project, userId: user.id });
    return NextResponse.json({ project, webhook }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
