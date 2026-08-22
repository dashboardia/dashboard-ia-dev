import { getExecutionCreditBudget } from "../lib/billing.js";
import { db } from "../lib/db.js";
import { detectEnvironmentRuntimeLabel } from "../lib/environment-runtime-label.js";
import { requeueFailedExecutionData } from "../lib/executions.js";
import { downloadGitHubArchive, getProjectGitHubAccessToken, verifyRepositoryBranch } from "../lib/github.js";
import { getGlobalSettings } from "../lib/global-settings.js";
import { createDashboardiaPreview, dashboardiaPreviewConfigured, deleteDashboardiaPreview, syncDashboardiaPreview } from "../lib/preview-host-client.js";
import { queuePreviewEnvironment, transitionPreviewEnvironment } from "../lib/preview-environments.js";
import { retireProjectEnvironments } from "../lib/project-environment-exclusivity.js";
import { detectGitHubProjectRuntime, environmentRuntimeConfiguration, mavenBuildCommandInRepository } from "../lib/project-runtime.js";
import { redactSensitiveData } from "../lib/redaction.js";

const ACTIVE_PREVIEW_STATUSES = ["QUEUED", "BUILDING", "DEPLOYING"];
const MINIMUM_CONVERSATION_TIMEOUT_MINUTES = 24 * 60;
const MAX_TECHNICAL_ERROR_LENGTH = 8_000;
const INFRASTRUCTURE_FAILURES = [
  /temporary failure in name resolution/i,
  /tls handshake timeout/i,
  /too many requests/i,
  /toomanyrequests/i,
  /service unavailable/i,
  /no space left on device/i,
  /cannot connect to the docker daemon/i,
  /connection reset by peer/i,
  /host de previews reiniciou/i,
  /\[INFRASTRUCTURE\]/i,
  /\[UNSUPPORTED\]/i,
];

function isInfrastructureFailure(error) {
  const value = String(error ?? "");
  return INFRASTRUCTURE_FAILURES.some((pattern) => pattern.test(value));
}

function correctionMessage(preview) {
  const technical = redactSensitiveData(String(preview.error || "O ambiente encerrou sem detalhar a causa"))
    .slice(-MAX_TECHNICAL_ERROR_LENGTH);
  return [
    "## Correção automática do ambiente",
    "A publicação automática do ambiente navegável desta execução falhou.",
    "Corrija a aplicação na mesma branch e no mesmo Pull Request para que ela compile, inicie e responda corretamente pela porta configurada.",
    "Preserve o escopo e todo o trabalho válido já realizado. Não substitua a aplicação por conteúdo estático apenas para mascarar a falha.",
    "Depois da correção, o Dashboard IA subirá e validará o ambiente novamente automaticamente.",
    `Erro real do ambiente:\n${technical}`,
  ].join("\n\n");
}

async function executionLog(database, executionId, message, level = "info", metadata = undefined) {
  return database.executionLog.create({ data: { executionId, scope: "preview", message, level, metadata } });
}

export async function requestExecutionPreviewAutomation(executionId, database = db, options = {}) {
  if (!dashboardiaPreviewConfigured()) return { status: "SKIPPED", reason: "preview-host-not-configured" };
  const settings = options.settings ?? await getGlobalSettings(database);
  const execution = await database.execution.findUnique({
    where: { id: executionId },
    include: { demand: { include: { project: true } } },
  });
  if (!execution
    || execution.status !== "AWAITING_CLIENT"
    || execution.closedAt
    || execution.cancelRequestedAt
    || execution.stopRequestedAt
    || execution.demand.type === "DOCUMENTATION"
    || !execution.branchName
    || !execution.headSha) {
    return { status: "SKIPPED", reason: "execution-not-ready" };
  }

  const project = execution.demand.project;
  const retired = await retireProjectEnvironments(database, project.id, { exceptExecutionId: execution.id });
  if (retired.total) {
    await executionLog(database, execution.id, `${retired.total} ambiente(s) anterior(es) deste projeto foram encerrados antes da nova publicação automática.`, "info", {
      automatic: true,
      retiredDevEnvironments: retired.devEnvironments,
      retiredExecutionPreviews: retired.executionPreviews,
    });
  }

  const environment = await queuePreviewEnvironment(database, {
    executionId: execution.id,
    ttlMinutes: settings.environmentTtlMinutes,
  });

  try {
    const token = await getProjectGitHubAccessToken(project, execution.requestedById);
    await verifyRepositoryBranch(token, project.repositoryFullName, execution.branchName);
    const detected = await detectGitHubProjectRuntime(token, project.repositoryFullName, execution.branchName);
    const runtimeLabel = await detectEnvironmentRuntimeLabel(token, project.repositoryFullName, execution.branchName, detected.runtime);
    const workingDirectory = detected.workingDirectory ?? ".";
    const configuration = environmentRuntimeConfiguration(project, detected);
    if (detected.runtime.startsWith("JAVA_MAVEN")) {
      configuration.buildCommand = mavenBuildCommandInRepository(configuration.buildCommand, workingDirectory);
    }
    if (!configuration.previewCommand || !configuration.previewPort) {
      const error = `[UNSUPPORTED] A stack ${runtimeLabel} não possui uma inicialização navegável detectável.`;
      await deleteDashboardiaPreview(environment.id).catch(() => null);
      await transitionPreviewEnvironment(database, environment.id, "FAILED", { error });
      await executionLog(database, execution.id, `A stack ${runtimeLabel} não possui uma inicialização navegável detectável; a execução continuará disponível sem ambiente automático.`, "warn");
      return { status: "FAILED", reason: "preview-command-not-detected" };
    }

    const archive = await downloadGitHubArchive(token, project.repositoryFullName, execution.branchName);
    const remote = await createDashboardiaPreview({
      previewId: environment.id,
      archive,
      configuration: {
        runtime: detected.runtime,
        displayRuntime: runtimeLabel,
        workingDirectory,
        installCommand: configuration.installCommand,
        buildCommand: configuration.buildCommand,
        previewCommand: configuration.previewCommand,
        auxiliaryPreviewCommand: detected.commands.auxiliaryPreviewCommand,
        auxiliaryPreviewPort: detected.commands.auxiliaryPreviewPort,
        port: configuration.previewPort,
        ttlMinutes: settings.environmentTtlMinutes,
        stripComponents: 1,
      },
    });
    await database.previewEnvironment.update({
      where: { id: environment.id },
      data: {
        externalId: remote.id,
        runtime: runtimeLabel,
        port: configuration.previewPort,
        attempts: { increment: 1 },
      },
    });
    await executionLog(database, execution.id, "Ambiente navegável iniciado automaticamente para esta execução.", "info", {
      automatic: true,
      previewEnvironmentId: environment.id,
      branchName: execution.branchName,
      runtime: runtimeLabel,
    });
    return { status: "QUEUED", previewEnvironmentId: environment.id };
  } catch (error) {
    const technical = redactSensitiveData(error instanceof Error ? error.message : String(error));
    await deleteDashboardiaPreview(environment.id).catch(() => null);
    await transitionPreviewEnvironment(database, environment.id, "FAILED", { error: `[INFRASTRUCTURE] ${technical}` }).catch(() => null);
    await executionLog(database, execution.id, "Não foi possível iniciar o ambiente automático por uma falha de infraestrutura; a execução continua aberta.", "warn", {
      automatic: true,
      technical: technical.slice(-4_000),
    }).catch(() => null);
    return { status: "FAILED", reason: "infrastructure" };
  }
}

async function queueAutomaticCorrection(preview, settings, database) {
  const execution = await database.execution.findUnique({
    where: { id: preview.executionId },
    include: { demand: true },
  });
  if (!execution || execution.status !== "AWAITING_CLIENT" || execution.closedAt || execution.cancelRequestedAt || execution.stopRequestedAt) return false;
  if (isInfrastructureFailure(preview.error)) return false;

  const creditBudget = await getExecutionCreditBudget(database, {
    executionId: execution.id,
    marginPercent: settings.creditBalanceSafetyMarginPercent,
  });
  if (creditBudget && creditBudget.hardLimitCredits < 1) return false;

  const now = new Date();
  const timeoutMinutes = Math.max(MINIMUM_CONVERSATION_TIMEOUT_MINUTES, settings.executionConversationTimeoutMinutes);
  const content = correctionMessage(preview);
  return database.$transaction(async (transaction) => {
    const updated = await transaction.execution.updateMany({
      where: {
        id: execution.id,
        status: "AWAITING_CLIENT",
        closedAt: null,
        cancelRequestedAt: null,
        stopRequestedAt: null,
      },
      data: requeueFailedExecutionData({ now, timeoutMinutes }),
    });
    if (updated.count !== 1) return false;

    await transaction.executionMessage.create({
      data: {
        executionId: execution.id,
        authorId: null,
        role: "USER",
        content,
      },
    });
    await transaction.executionLog.create({
      data: {
        executionId: execution.id,
        scope: "preview",
        level: "warn",
        message: "O ambiente automático falhou; o erro foi enviado à IA e esta mesma execução retornou à fila para correção.",
        metadata: {
          automatic: true,
          previewEnvironmentId: preview.id,
          technical: redactSensitiveData(String(preview.error || "")).slice(-4_000),
        },
      },
    });
    await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "QUEUED" } });
    return true;
  });
}

async function markTimedOut(preview, settings, database) {
  const timeoutMinutes = Math.max(1, Number(settings.previewPreparationTimeoutMinutes) || 15);
  if (Date.now() - new Date(preview.requestedAt).getTime() < timeoutMinutes * 60_000) return preview;

  await deleteDashboardiaPreview(preview.externalId ?? preview.id).catch(() => null);
  const error = `O ambiente automático não ficou pronto dentro de ${timeoutMinutes} minutos.`;
  return transitionPreviewEnvironment(database, preview.id, "FAILED", { error }).catch(async () => (
    database.previewEnvironment.update({ where: { id: preview.id }, data: { status: "FAILED", error } })
  ));
}

export async function syncExecutionPreviewAutomations(database = db, options = {}) {
  const settings = options.settings ?? await getGlobalSettings(database);
  const previews = await database.previewEnvironment.findMany({
    where: {
      status: { in: ACTIVE_PREVIEW_STATUSES },
      execution: {
        status: "AWAITING_CLIENT",
        closedAt: null,
        cancelRequestedAt: null,
        stopRequestedAt: null,
        demand: { type: { not: "DOCUMENTATION" } },
      },
    },
    orderBy: { requestedAt: "asc" },
    take: 25,
  });

  let requeued = 0;
  for (const preview of previews) {
    let current;
    try {
      current = await syncDashboardiaPreview(database, preview);
    } catch (error) {
      console.error(`[preview-automation:${preview.id}] sincronização falhou`, error);
      continue;
    }

    if (ACTIVE_PREVIEW_STATUSES.includes(current.status)) {
      current = await markTimedOut(current, settings, database);
    }
    if (current.status === "FAILED" && await queueAutomaticCorrection(current, settings, database)) requeued += 1;
  }
  return { checked: previews.length, requeued };
}
