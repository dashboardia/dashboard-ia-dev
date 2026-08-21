import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { createGitHubPullRequest, findOpenGitHubPullRequest, getProjectGitHubAccessToken } from "../../../../../lib/github";
import { getGlobalSettings } from "../../../../../lib/global-settings";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { pullRequest: true, demand: { include: { project: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    if (execution.pullRequest) return NextResponse.json({ pullRequest: execution.pullRequest });
    if (execution.status !== "WAITING_APPROVAL" || !execution.branchName) {
      return NextResponse.json({ error: "A execução ainda não está pronta para Pull Request" }, { status: 409 });
    }

    const lockId = `pull-request:${user.id}:${randomUUID()}`;
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const claimed = await db.execution.updateMany({
      where: {
        id: executionId,
        status: "WAITING_APPROVAL",
        branchName: { not: null },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      },
      data: { lockedAt: new Date(), lockedBy: lockId },
    });
    if (claimed.count !== 1) {
      const current = await db.execution.findUnique({ where: { id: executionId }, include: { pullRequest: true } });
      if (current?.pullRequest) return NextResponse.json({ pullRequest: current.pullRequest });
      return NextResponse.json({ error: "A abertura do Pull Request já está em andamento" }, { status: 409 });
    }

    let completed = false;
    try {
      const settings = await getGlobalSettings();
      const token = await getProjectGitHubAccessToken(execution.demand.project, user.id);
      const existingPullRequest = await findOpenGitHubPullRequest(
        token,
        execution.demand.project.repositoryFullName,
        execution.branchName,
        execution.demand.project.defaultBranch,
      );
      const body = [
        `## Demanda\n${execution.demand.description}`,
        execution.demand.acceptanceCriteria ? `## Critérios de aceite\n${execution.demand.acceptanceCriteria}` : null,
        execution.summary ? `## Resultado da execução\n${execution.summary}` : null,
        "---\nPull Request criado automaticamente pelo Dashboard IA. Novos ajustes podem ser enviados pelo chat da execução.",
      ].filter(Boolean).join("\n\n");
      const githubPullRequest = existingPullRequest ?? await createGitHubPullRequest(token, execution.demand.project.repositoryFullName, {
        title: execution.demand.title,
        body,
        head: execution.branchName,
        base: execution.demand.project.defaultBranch,
        draft: true,
      });

      const pullRequest = await db.$transaction(async (transaction) => {
        const created = await transaction.pullRequest.create({
          data: {
            executionId,
            projectId: execution.demand.projectId,
            demandId: execution.demandId,
            externalNumber: githubPullRequest.number,
            url: githubPullRequest.html_url,
            title: githubPullRequest.title,
            status: githubPullRequest.draft ? "DRAFT" : "OPEN",
            headBranch: execution.branchName,
            baseBranch: execution.demand.project.defaultBranch,
          },
        });
        const updated = await transaction.execution.updateMany({
          where: { id: executionId, lockedBy: lockId },
          data: {
            status: "AWAITING_CLIENT",
            stage: "PUBLISH",
            lockedAt: null,
            lockedBy: null,
            finishedAt: null,
            lastInteractionAt: new Date(),
            conversationExpiresAt: new Date(Date.now() + Math.max(24 * 60, settings.executionConversationTimeoutMinutes) * 60_000),
          },
        });
        if (updated.count !== 1) throw new Error("A trava da abertura do Pull Request expirou");
        await transaction.executionMessage.create({ data: { executionId, role: "SYSTEM", content: `Pull Request #${created.externalNumber} aberto. A execução continuará disponível para ajustes até ser concluída pelo cliente ou expirar por inatividade.` } });
        await transaction.auditLog.create({
          data: auditData({
            actorId: user.id,
            projectId: execution.demand.projectId,
            action: "pull_request.create",
            entityType: "PullRequest",
            entityId: created.id,
            metadata: { externalNumber: created.externalNumber, automatic: true, recovered: Boolean(existingPullRequest) },
            request,
          }),
        });
        return created;
      });
      completed = true;
      return NextResponse.json({ pullRequest }, { status: 201 });
    } finally {
      if (!completed) {
        await db.execution.updateMany({
          where: { id: executionId, lockedBy: lockId },
          data: { lockedAt: null, lockedBy: null },
        }).catch(() => null);
      }
    }
  } catch (error) {
    return apiError(error);
  }
}
