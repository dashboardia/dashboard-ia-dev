import { NextResponse } from "next/server";

import { requireAdmin, requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { getGitHubAccessToken, verifyRepositoryAccess } from "../../../lib/github";
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
    const user = await requireAdmin();
    const input = projectInputSchema.parse(await request.json());
    const token = await getGitHubAccessToken(user.id);
    const githubRepository = await verifyRepositoryAccess(token, input.repositoryFullName.toLowerCase());
    if (!githubRepository.permissions?.push) {
      return NextResponse.json({ error: "Sua conta GitHub não possui permissão de escrita neste repositório" }, { status: 403 });
    }
    const slug = await createUniqueProjectSlug(input.name);

    const project = await db.$transaction(async (transaction) => {
      const created = await transaction.project.create({
        data: {
          ...input,
          slug,
          repositoryFullName: input.repositoryFullName.toLowerCase(),
          repositoryId: String(githubRepository.id),
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
