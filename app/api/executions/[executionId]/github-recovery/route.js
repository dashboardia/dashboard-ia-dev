import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { prepareExecutionBilling } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { queueDemandExecution } from "../../../../../lib/executions";
import { isGitHubAuthorizationFailure } from "../../../../../lib/github-authorization-recovery";
import {
  findGitHubRepositoryInstallation,
  getGitHubAppInstallUrl,
  getGitHubInstallationToken,
  verifyRepositoryAccess,
  verifyRepositoryBranch,
} from "../../../../../lib/github";
import { assertOperationalAccess } from "../../../../../lib/operational-access";
import { assertPlatformProcessingEnabled } from "../../../../../lib/platform-processing";
import { configureProjectGitHubWebhook } from "../../../../../lib/project-webhooks";

async function loadExecution(executionId) {
  return db.execution.findUniqueOrThrow({
    where: { id: executionId },
    include: { demand: { include: { project: true } } },
  });
}

async function newerExecutionExists(execution) {
  const newer = await db.execution.findFirst({
    where: { demandId: execution.demandId, createdAt: { gt: execution.createdAt } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(newer);
}

function recoveryIsAvailable(execution) {
  return execution.status === "FAILED" && isGitHubAuthorizationFailure(execution.error);
}

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await loadExecution(executionId);
    await requireProjectRole(execution.demand.projectId, "MANAGER");
    const required = recoveryIsAvailable(execution) && !(await newerExecutionExists(execution));
    if (!required) return NextResponse.json({ required: false }, { headers: { "Cache-Control": "no-store" } });

    return NextResponse.json({
      required: true,
      repositoryFullName: execution.demand.project.repositoryFullName,
      installUrl: getGitHubAppInstallUrl(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    if (!env.OPENAI_API_KEY) return NextResponse.json({ error: "O processamento de IA está indisponível no momento." }, { status: 503 });
    await assertPlatformProcessingEnabled(db);

    const { executionId } = await context.params;
    const execution = await loadExecution(executionId);
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    await assertOperationalAccess(user);
    if (!recoveryIsAvailable(execution)) {
      return NextResponse.json({ error: "Esta execução não está aguardando autorização do GitHub." }, { status: 409 });
    }
    if (await newerExecutionExists(execution)) {
      return NextResponse.json({ error: "Já existe um reprocessamento mais recente desta demanda." }, { status: 409 });
    }

    const repositoryFullName = execution.demand.project.repositoryFullName;
    const installation = await findGitHubRepositoryInstallation(repositoryFullName);
    if (!installation?.id) {
      return NextResponse.json({
        error: "A autorização ainda não foi encontrada. Clique em Autorizar GitHub, selecione este repositório e depois tente reprocessar novamente.",
        code: "GITHUB_APP_NOT_AUTHORIZED",
      }, { status: 409 });
    }

    const githubInstallationId = String(installation.id);
    const token = await getGitHubInstallationToken(githubInstallationId);
    const githubRepository = await verifyRepositoryAccess(token, repositoryFullName);
    if (githubRepository.permissions?.push === false) {
      return NextResponse.json({ error: "O GitHub App está instalado, mas ainda não possui permissão de escrita neste repositório." }, { status: 403 });
    }
    await verifyRepositoryBranch(token, repositoryFullName, execution.demand.baseBranch);

    const project = await db.project.update({
      where: { id: execution.demand.projectId },
      data: {
        githubInstallationId,
        repositoryId: githubRepository.id ? String(githubRepository.id) : execution.demand.project.repositoryId,
      },
    });
    await configureProjectGitHubWebhook({ project, userId: user.id }).catch(() => null);

    const adminLimitBypass = user.globalRole === "ADMIN";
    const billing = adminLimitBypass ? { bypass: true } : await prepareExecutionBilling({ demand: execution.demand });
    const queued = await queueDemandExecution({
      demand: execution.demand,
      requestedById: user.id,
      billing,
      allowEmptyRepository: execution.allowEmptyRepository,
    });
    const retryExecutionId = queued.activeExecutionId ?? queued.execution?.id;
    if (!retryExecutionId) throw new Error("Não foi possível criar o reprocessamento");

    if (queued.execution) {
      await db.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.github_authorized_retry",
          entityType: "Execution",
          entityId: queued.execution.id,
          metadata: {
            sourceExecutionId: execution.id,
            githubInstallationId,
            repositoryFullName,
            adminLimitBypass,
          },
          request,
        }),
      });
    }

    return NextResponse.json({ executionId: retryExecutionId, reusedActiveExecution: Boolean(queued.activeExecutionId) }, { status: queued.execution ? 202 : 200 });
  } catch (error) {
    return apiError(error);
  }
}
