import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { requeueFailedExecutionData } from "../../../../../lib/executions";
import { githubInstallationPublicationAccess, installationRepositoryListIncludes, isGitHubAuthorizationFailure } from "../../../../../lib/github-authorization-recovery";
import {
  findGitHubRepositoryInstallation,
  getGitHubAppInstallUrl,
  getGitHubInstallationToken,
  githubRequest,
  verifyRepositoryAccess,
  verifyRepositoryBranch,
} from "../../../../../lib/github";
import { getGlobalSettings } from "../../../../../lib/global-settings";
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
  return ["FAILED", "AWAITING_CLIENT"].includes(execution.status)
    && !execution.closedAt
    && isGitHubAuthorizationFailure(execution.error);
}

async function installationIncludesRepository(token, repositoryFullName, repositorySelection) {
  if (repositorySelection === "all") return true;
  for (let page = 1; page <= 20; page += 1) {
    const payload = await githubRequest(token, `/installation/repositories?per_page=100&page=${page}`);
    if (installationRepositoryListIncludes(payload, repositoryFullName)) return true;
    const repositories = Array.isArray(payload?.repositories) ? payload.repositories : [];
    if (repositories.length < 100) return false;
  }
  return false;
}

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await loadExecution(executionId);
    await requireProjectRole(execution.demand.projectId, "MANAGER");
    const required = recoveryIsAvailable(execution) && !(await newerExecutionExists(execution));
    if (!required) return NextResponse.json({ required: false }, { headers: { "Cache-Control": "no-store" } });

    const repositoryFullName = execution.demand.project.repositoryFullName;
    const installation = await findGitHubRepositoryInstallation(repositoryFullName).catch(() => null);
    return NextResponse.json({
      required: true,
      repositoryFullName,
      installUrl: installation?.html_url ?? getGitHubAppInstallUrl(),
      installationDetected: Boolean(installation?.id),
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
        error: "A autorização ainda não foi encontrada. Abra a autorização, selecione este repositório, clique em Save no GitHub e depois tente novamente.",
        code: "GITHUB_APP_NOT_AUTHORIZED",
      }, { status: 409 });
    }

    const publicationAccess = githubInstallationPublicationAccess(installation);
    if (!publicationAccess.canPublish) {
      return NextResponse.json({
        error: "O GitHub App está instalado, mas a instalação não possui permissão de escrita em Code e Pull requests. Atualize as permissões do App e tente novamente.",
        code: "GITHUB_APP_WRITE_PERMISSION_REQUIRED",
      }, { status: 403 });
    }

    const githubInstallationId = String(installation.id);
    const token = await getGitHubInstallationToken(githubInstallationId);
    const repositorySelected = await installationIncludesRepository(token, repositoryFullName, installation.repository_selection);
    if (!repositorySelected) {
      return NextResponse.json({
        error: "Este repositório ainda não foi salvo na seleção do GitHub App. No GitHub, marque o repositório e clique em Save; depois volte e reprocese.",
        code: "GITHUB_REPOSITORY_NOT_SELECTED",
      }, { status: 409 });
    }

    const githubRepository = await verifyRepositoryAccess(token, repositoryFullName);
    await verifyRepositoryBranch(token, repositoryFullName, execution.demand.baseBranch);

    const project = await db.project.update({
      where: { id: execution.demand.projectId },
      data: {
        githubInstallationId,
        repositoryId: githubRepository.id ? String(githubRepository.id) : execution.demand.project.repositoryId,
      },
    });
    await configureProjectGitHubWebhook({ project, userId: user.id }).catch(() => null);

    const settings = await getGlobalSettings();
    const now = new Date();
    await db.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: { id: execution.id, status: { in: ["FAILED", "AWAITING_CLIENT"] }, closedAt: null },
        data: requeueFailedExecutionData({ now, timeoutMinutes: settings.executionConversationTimeoutMinutes }),
      });
      if (updated.count !== 1) throw new Error("A execução mudou de estado enquanto a autorização era confirmada");
      await transaction.executionMessage.create({
        data: { executionId: execution.id, authorId: user.id, role: "SYSTEM", content: "Autorização do GitHub confirmada. A mesma execução foi reenviada para processamento." },
      });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "QUEUED" } });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.github_authorized_retry",
          entityType: "Execution",
          entityId: execution.id,
          metadata: {
            githubInstallationId,
            repositoryFullName,
            repositorySelection: installation.repository_selection ?? null,
            reusedExecution: true,
          },
          request,
        }),
      });
    });

    return NextResponse.json({ executionId: execution.id, reusedExecution: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
