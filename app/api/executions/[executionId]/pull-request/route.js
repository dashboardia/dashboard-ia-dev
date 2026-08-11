import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { createGitHubPullRequest, getGitHubAccessToken } from "../../../../../lib/github";

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

    const token = await getGitHubAccessToken(user.id);
    const body = [
      `## Demanda\n${execution.demand.description}`,
      execution.demand.acceptanceCriteria ? `## Critérios de aceite\n${execution.demand.acceptanceCriteria}` : null,
      execution.summary ? `## Resultado da execução\n${execution.summary}` : null,
      "---\nPull Request criado pelo Forgeboard após aprovação de um Gestor.",
    ].filter(Boolean).join("\n\n");
    const githubPullRequest = await createGitHubPullRequest(token, execution.demand.project.repositoryFullName, {
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
      await transaction.execution.update({ where: { id: executionId }, data: { status: "SUCCEEDED", stage: "PUBLISH", approvedById: user.id, finishedAt: new Date() } });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId: execution.demand.projectId, action: "pull_request.create", entityType: "PullRequest", entityId: created.id, metadata: { externalNumber: created.externalNumber }, request }),
      });
      return created;
    });
    return NextResponse.json({ pullRequest }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
