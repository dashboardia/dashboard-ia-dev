import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { prepareExecutionBilling } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { queueDemandExecution } from "../../../../../lib/executions";
import { getProjectGitHubAccessToken, RepositoryBranchContentError, verifyRepositoryProjectBranch } from "../../../../../lib/github";
import { assertPlatformProcessingEnabled } from "../../../../../lib/platform-processing";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    if (!env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Configure OPENAI_API_KEY antes de executar" }, { status: 503 });
    }
    await assertPlatformProcessingEnabled(db);

    const { demandId } = await context.params;
    const demand = await db.demand.findUniqueOrThrow({
      where: { id: demandId },
      include: { project: { select: { repositoryFullName: true, defaultBranch: true, githubInstallationId: true } } },
    });
    const { user } = await requireProjectRole(demand.projectId, "MANAGER");
    if (!["APPROVED", "FAILED", "STOPPED"].includes(demand.status)) {
      return NextResponse.json({ error: "A demanda precisa estar aprovada para entrar na fila" }, { status: 409 });
    }

    const token = await getProjectGitHubAccessToken(demand.project, user.id);
    try {
      await verifyRepositoryProjectBranch(token, demand.project.repositoryFullName, demand.project.defaultBranch);
    } catch (error) {
      if (error instanceof RepositoryBranchContentError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return NextResponse.json({
        error: `A branch ${demand.project.defaultBranch} ainda não existe. Crie o primeiro arquivo no repositório antes de iniciar a análise.`,
      }, { status: 409 });
    }

    const billing = await prepareExecutionBilling({ demand });
    const { activeExecutionId, execution } = await queueDemandExecution({ demand, requestedById: user.id, billing });
    if (activeExecutionId) {
      return NextResponse.json({ error: "Já existe uma execução ativa", executionId: activeExecutionId }, { status: 409 });
    }

    await db.auditLog.create({
      data: auditData({ actorId: user.id, projectId: demand.projectId, action: "execution.queue", entityType: "Execution", entityId: execution.id, request }),
    });
    return NextResponse.json({ execution }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
