import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { prepareExecutionBilling } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { queueDemandExecution } from "../../../../../lib/executions";
import { getProjectGitHubAccessToken, RepositoryBranchContentError, verifyRepositoryProjectBranch } from "../../../../../lib/github";
import { assertOperationalAccess } from "../../../../../lib/operational-access";
import { assertPlatformProcessingEnabled } from "../../../../../lib/platform-processing";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const input = await request.json().catch(() => ({}));
    const emptyRepositoryConfirmed = input?.allowEmptyRepository === true;
    let allowEmptyRepository = false;
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
    await assertOperationalAccess(user);
    if (!["PENDING_APPROVAL", "APPROVED", "FAILED", "STOPPED"].includes(demand.status)) {
      return NextResponse.json({ error: "Esta demanda não está disponível para iniciar uma execução" }, { status: 409 });
    }

    const token = await getProjectGitHubAccessToken(demand.project, user.id);
    try {
      await verifyRepositoryProjectBranch(token, demand.project.repositoryFullName, demand.baseBranch);
    } catch (error) {
      if (error instanceof RepositoryBranchContentError) {
        if (!emptyRepositoryConfirmed) {
          return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
        }
        allowEmptyRepository = true;
      } else return NextResponse.json({
        error: `A branch ${demand.baseBranch} não existe mais no repositório. Selecione outra branch na demanda antes de iniciar.`,
      }, { status: 409 });
    }

    const adminLimitBypass = user.globalRole === "ADMIN";
    const billing = adminLimitBypass ? { bypass: true } : await prepareExecutionBilling({ demand });
    const { activeExecutionId, execution } = await queueDemandExecution({ demand, requestedById: user.id, billing, allowEmptyRepository });
    if (activeExecutionId) {
      return NextResponse.json({ error: "Já existe uma execução ativa", executionId: activeExecutionId }, { status: 409 });
    }

    await db.auditLog.create({
      data: auditData({ actorId: user.id, projectId: demand.projectId, action: "execution.queue", entityType: "Execution", entityId: execution.id, metadata: { allowEmptyRepository, baseBranch: demand.baseBranch, adminLimitBypass, approvalStepSkipped: demand.status === "PENDING_APPROVAL" }, request }),
    });
    return NextResponse.json({ execution }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
