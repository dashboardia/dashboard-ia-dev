import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { assertCanCreateProject, claimTrialOrganization } from "../../../lib/billing";
import { db } from "../../../lib/db";
import { explainError } from "../../../lib/error-messages";
import { findGitHubRepositoryInstallation, getGitHubAccessToken, getGitHubInstallationToken, verifyRepositoryAccess, verifyRepositoryBranch } from "../../../lib/github";
import { createUniqueProjectSlug, projectAccessWhere, projectConnectionMode } from "../../../lib/projects";
import { applyDetectedRuntime, detectGitHubProjectRuntime } from "../../../lib/project-runtime";
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
    const currentProject = await db.project.findUnique({
      where: { provider_repositoryFullName: { provider: "GITHUB", repositoryFullName } },
      select: { id: true, createdById: true, status: true },
    });
    projectConnectionMode(currentProject, user);
    await assertCanCreateProject(user);

    const repositoryInstallation = input.githubInstallationId
      ? { id: input.githubInstallationId }
      : await findGitHubRepositoryInstallation(repositoryFullName);
    const githubInstallationId = repositoryInstallation?.id ? String(repositoryInstallation.id) : undefined;
    const token = githubInstallationId
      ? await getGitHubInstallationToken(githubInstallationId)
      : await getGitHubAccessToken(user.id);
    const githubRepository = await verifyRepositoryAccess(token, repositoryFullName);
    if (!githubInstallationId && !githubRepository.permissions?.push) {
      return NextResponse.json({ error: "Sua conta GitHub não possui permissão de escrita neste repositório" }, { status: 403 });
    }
    if (githubRepository.size > 0) {
      try {
        await verifyRepositoryBranch(token, input.repositoryFullName.toLowerCase(), input.defaultBranch);
      } catch {
        return NextResponse.json({ error: `A branch ${input.defaultBranch} não existe neste repositório` }, { status: 422 });
      }
    }

    let detectionWarning;
    let detectedRuntime = { runtime: githubRepository.size > 0 ? "UNKNOWN" : "EMPTY", commands: {} };
    if (githubRepository.size > 0) {
      try {
        detectedRuntime = await detectGitHubProjectRuntime(token, repositoryFullName, input.defaultBranch);
      } catch (detectionError) {
        detectionWarning = explainError(detectionError instanceof Error ? detectionError.message : detectionError).technical;
        console.warn(`[projects] Não foi possível detectar a tecnologia de ${repositoryFullName}`, detectionError);
      }
    }
    const resolvedInput = applyDetectedRuntime(input, detectedRuntime);

    const project = await db.$transaction(async (transaction) => {
      const existingProject = await transaction.project.findUnique({
        where: { provider_repositoryFullName: { provider: "GITHUB", repositoryFullName } },
      });
      const mode = projectConnectionMode(existingProject, user);
      const billing = await assertCanCreateProject(user, transaction);
      await claimTrialOrganization(billing.account, repositoryFullName, transaction);

      if (mode === "RESTORE") {
        // A chave do repositório já identifica exatamente o registro arquivado.
        // Não a regrave com a capitalização recebida do formulário: versões
        // anteriores podiam persistir duplicatas lógicas com caixa diferente,
        // o que faria a restauração colidir com o índice único do PostgreSQL.
        const restored = await transaction.project.update({
          where: { id: existingProject.id },
          data: {
            ...resolvedInput,
            repositoryFullName: existingProject.repositoryFullName,
            status: "ACTIVE",
            repositoryId: String(githubRepository.id),
            githubInstallationId: githubInstallationId ?? existingProject.githubInstallationId,
          },
        });
        await transaction.projectMember.upsert({
          where: { projectId_userId: { projectId: existingProject.id, userId: user.id } },
          update: { role: "MANAGER" },
          create: { projectId: existingProject.id, userId: user.id, role: "MANAGER" },
        });
        await transaction.auditLog.create({
          data: auditData({
            actorId: user.id,
            projectId: restored.id,
            action: "project.restore",
            entityType: "Project",
            entityId: restored.id,
            metadata: { repositoryFullName: restored.repositoryFullName },
            request,
          }),
        });
        return restored;
      }

      const slug = await createUniqueProjectSlug(input.name, transaction);
      const created = await transaction.project.create({
        data: {
          ...resolvedInput,
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
    return NextResponse.json({ project, webhook, detectedRuntime: detectedRuntime.runtime, detectionWarning }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
