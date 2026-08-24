import { getExecutionCreditBudget } from "../lib/billing.js";
import { db } from "../lib/db.js";
import { detectEnvironmentRuntimeLabel } from "../lib/environment-runtime-label.js";
import { downloadGitHubArchive, getProjectGitHubAccessToken, verifyRepositoryBranch } from "../lib/github.js";
import { getGlobalSettings } from "../lib/global-settings.js";
import { createDashboardiaPreview, dashboardiaPreviewConfigured, deleteDashboardiaPreview, syncDashboardiaPreview } from "../lib/preview-host-client.js";
import { queuePreviewEnvironment, transitionPreviewEnvironment } from "../lib/preview-environments.js";
import { previewRepairConsentError, previewRepairConsentRequired } from "../lib/preview-repair-consent.js";
import { retireProjectEnvironments } from "../lib/project-environment-exclusivity.js";
import { detectGitHubProjectRuntime, environmentRuntimeConfiguration, mavenBuildCommandInRepository } from "../lib/project-runtime.js";
import { redactSensitiveData } from "../lib/redaction.js";
import {
  MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS,
  MAX_AUTOMATIC_APPLICATION_REPAIRS,
  applicationRepairDecision,
  automaticApplicationRepairCount,
  automaticPreviewCorrectionRequeueData,
  classifyPreviewFailure,
  isPreviewCircuitOpen,
  isRetryableInfrastructureFailure,
  previewCircuitOpenError,
  previewFailureSignature,
} from "./preview-recovery-policy.mjs";

const ACTIVE_PREVIEW_STATUSES = ["QUEUED", "BUILDING", "DEPLOYING"];
const WATCHED_PREVIEW_STATUSES = [...ACTIVE_PREVIEW_STATUSES, "FAILED"];
const MINIMUM_CONVERSATION_TIMEOUT_MINUTES = 24 * 60;
const MAX_TECHNICAL_ERROR_LENGTH = 8_000;

function correctionMessage(preview, repairNumber) {
  const technical = redactSensitiveData(String(preview.error || "O ambiente encerrou sem detalhar a causa"))
    .slice(-MAX_TECHNICAL_ERROR_LENGTH);
  return [
    `## Correção automática do ambiente ${repairNumber}/${MAX_AUTOMATIC_APPLICATION_REPAIRS}`,
    "A publicação automática do ambiente navegável desta execução falhou por uma causa atribuída ao build ou à inicialização da aplicação.",
    "Corrija a aplicação na mesma branch e no mesmo Pull Request para que ela compile, inicie e responda corretamente pela porta configurada.",
    "Preserve o escopo e todo o trabalho válido já realizado. Não substitua a aplicação por conteúdo estático apenas para mascarar a falha.",
    "Não repita uma correção já tentada para o mesmo erro. Se a causa não estiver no código da aplicação, não altere arquivos e informe explicitamente o bloqueio.",
    "Depois da correção, o Dashboard IA subirá e validará o ambiente novamente automaticamente.",
    `Erro real do ambiente:\n${technical}`,
  ].join("\n\n");
}

async function executionLog(database, executionId, message, level = "info", metadata = undefined) {
  return database.executionLog.create({ data: { executionId, scope: "preview", message, level, metadata } });
}

function logMetadata(entry) {
  return entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
    ? entry.metadata
    : {};
}

function signatureSeen(logs, signature, predicate = () => true) {
  return logs.some((entry) => {
    const metadata = logMetadata(entry);
    return metadata.failureSignature === signature && predicate(metadata, entry);
  });
}

async function loadExecutionForRecovery(preview, database) {
  return database.execution.findUnique({
    where: { id: preview.executionId },
    include: {
      demand: true,
      logs: {
        where: { scope: "preview" },
        orderBy: { createdAt: "desc" },
        select: { id: true, message: true, metadata: true, createdAt: true },
      },
    },
  });
}

async function openPreviewCircuit(preview, execution, database, {
  failureClass,
  failureSignature,
  message,
}) {
  const technical = redactSensitiveData(String(preview.error || "")).slice(-4_000);
  const markedError = previewCircuitOpenError(preview.error);
  const updated = await database.previewEnvironment.updateMany({
    where: { id: preview.id, status: "FAILED", error: preview.error },
    data: { error: markedError },
  });
  if (updated.count !== 1) return false;

  await executionLog(database, execution.id, message, "warn", {
    automatic: true,
    circuitOpen: true,
    aiInvoked: false,
    failureClass,
    failureSignature,
    previewEnvironmentId: preview.id,
    previewAttempts: preview.attempts,
    technical,
  });
  return true;
}

async function requestApplicationRepairConsent(preview, execution, database, {
  automaticRepairCount,
  failureSignature,
  reason,
}) {
  const technical = redactSensitiveData(String(preview.error || "")).slice(-4_000);
  const markedError = previewRepairConsentError(preview.error);
  return database.$transaction(async (transaction) => {
    const updated = await transaction.previewEnvironment.updateMany({
      where: { id: preview.id, status: "FAILED", error: preview.error },
      data: { error: markedError },
    });
    if (updated.count !== 1) return false;

    await transaction.executionMessage.create({
      data: {
        executionId: execution.id,
        authorId: null,
        role: "SYSTEM",
        content: [
          "## O ambiente ainda precisa de uma correção",
          "O ambiente navegável ainda não ficou pronto.",
          "A falha mais recente foi classificada como um problema de build ou inicialização que pode ser tratado pela IA no código do projeto.",
          reason === "insufficient-credits"
            ? "A próxima correção não foi iniciada porque não há créditos disponíveis."
            : "As correções automáticas previstas para este ciclo terminaram. Uma nova tentativa só será iniciada após sua confirmação.",
          "A branch, o Pull Request e todo o histórico permanecem preservados.",
        ].join("\n\n"),
      },
    });
    await transaction.executionLog.create({
      data: {
        executionId: execution.id,
        scope: "preview",
        level: "warn",
        message: "A correção do código ainda não deixou o ambiente pronto. A execução aguarda a decisão do cliente antes de usar uma nova interação com a IA.",
        metadata: {
          automatic: true,
          consentRequired: true,
          aiInvoked: false,
          failureClass: "APPLICATION",
          failureSignature,
          automaticRepairCount,
          reason,
          previewEnvironmentId: preview.id,
          previewAttempts: preview.attempts,
          technical,
        },
      },
    });
    return true;
  });
}

async function queueAutomaticCorrection(preview, settings, database, execution, failureSignature) {
  const decision = applicationRepairDecision({ logs: execution.logs });
  if (decision.action === "REQUEST_CONSENT") {
    await requestApplicationRepairConsent(preview, execution, database, {
      automaticRepairCount: decision.automaticRepairCount,
      failureSignature,
      reason: decision.reason,
    });
    return false;
  }

  const creditBudget = await getExecutionCreditBudget(database, {
    executionId: execution.id,
    marginPercent: settings.creditBalanceSafetyMarginPercent,
  });
  if (creditBudget && creditBudget.hardLimitCredits < 1) {
    await requestApplicationRepairConsent(preview, execution, database, {
      automaticRepairCount: decision.automaticRepairCount,
      failureSignature,
      reason: "insufficient-credits",
    });
    return false;
  }

  const now = new Date();
  const timeoutMinutes = Math.max(MINIMUM_CONVERSATION_TIMEOUT_MINUTES, settings.executionConversationTimeoutMinutes);
  const repairNumber = decision.repairNumber;
  const content = correctionMessage(preview, repairNumber);
  return database.$transaction(async (transaction) => {
    const updated = await transaction.execution.updateMany({
      where: {
        id: execution.id,
        status: "AWAITING_CLIENT",
        closedAt: null,
        cancelRequestedAt: null,
        stopRequestedAt: null,
      },
      data: automaticPreviewCorrectionRequeueData({ now, timeoutMinutes }),
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
        message: `O ambiente falhou por uma causa atribuída à aplicação; a correção automática ${repairNumber}/${MAX_AUTOMATIC_APPLICATION_REPAIRS} foi enviada à IA e a execução retornou à fila.`,
        metadata: {
          automatic: true,
          aiInvoked: true,
          failureClass: "APPLICATION",
          failureSignature,
          automaticRepairNumber: repairNumber,
          previewEnvironmentId: preview.id,
          technical: redactSensitiveData(String(preview.error || "")).slice(-4_000),
        },
      },
    });
    await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "QUEUED" } });
    return true;
  });
}

async function retryInfrastructurePreview(preview, settings, database, execution, failureClass, failureSignature) {
  const repeatedSignature = signatureSeen(execution.logs, failureSignature, (metadata) => metadata.infrastructureRetryScheduled === true);
  const retryable = failureClass === "INFRASTRUCTURE" && isRetryableInfrastructureFailure(preview.error);
  const attemptLimitReached = Number(preview.attempts || 0) >= MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS;

  if (!retryable || repeatedSignature || attemptLimitReached) {
    const reason = repeatedSignature
      ? "a mesma assinatura de erro de infraestrutura se repetiu"
      : attemptLimitReached
        ? `o limite de ${MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS} tentativas internas foi atingido`
        : "não existe evidência suficiente de que o código da aplicação seja a causa";
    await openPreviewCircuit(preview, execution, database, {
      failureClass,
      failureSignature,
      message: `Falha de infraestrutura — IA não acionada. ${reason}; o circuit breaker interrompeu novas tentativas automáticas.`,
    });
    return false;
  }

  const claimed = await database.previewEnvironment.updateMany({
    where: { id: preview.id, status: "FAILED", error: preview.error },
    data: {
      status: "QUEUED",
      externalId: null,
      url: null,
      error: null,
      requestedAt: new Date(),
      startedAt: null,
      readyAt: null,
      stoppedAt: null,
      lastHeartbeatAt: null,
    },
  });
  if (claimed.count !== 1) return false;

  await executionLog(database, execution.id, `Falha de infraestrutura — IA não acionada. Retentativa interna gratuita ${Math.min(Number(preview.attempts || 0) + 1, MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS)}/${MAX_FREE_INFRASTRUCTURE_PREVIEW_ATTEMPTS} do preview.`, "warn", {
    automatic: true,
    aiInvoked: false,
    infrastructureRetryScheduled: true,
    failureClass,
    failureSignature,
    previewEnvironmentId: preview.id,
    previewAttempts: preview.attempts,
    technical: redactSensitiveData(String(preview.error || "")).slice(-4_000),
  });

  const retried = await requestExecutionPreviewAutomation(preview.executionId, database, {
    settings,
    infrastructureRetry: true,
  });
  if (retried.status === "SKIPPED") {
    await database.previewEnvironment.updateMany({
      where: { id: preview.id, status: "QUEUED" },
      data: { status: "FAILED", error: previewCircuitOpenError(preview.error) },
    }).catch(() => null);
  }
  return retried.status !== "SKIPPED";
}

async function handleFailedPreview(preview, settings, database) {
  if (!preview?.error || previewRepairConsentRequired(preview.error)) return false;

  const execution = await loadExecutionForRecovery(preview, database);
  if (!execution || execution.status !== "AWAITING_CLIENT" || execution.closedAt || execution.cancelRequestedAt || execution.stopRequestedAt) return false;

  const failureClass = classifyPreviewFailure(preview.error);
  const failureSignature = previewFailureSignature(preview.error);

  if (failureClass === "APPLICATION") {
    if (isPreviewCircuitOpen(preview.error)) {
      await requestApplicationRepairConsent(preview, execution, database, {
        automaticRepairCount: automaticApplicationRepairCount(execution.logs),
        failureSignature,
        reason: "legacy-application-circuit",
      });
      return false;
    }
    return queueAutomaticCorrection(preview, settings, database, execution, failureSignature);
  }

  if (isPreviewCircuitOpen(preview.error)) return false;

  return retryInfrastructurePreview(preview, settings, database, execution, failureClass, failureSignature);
}

export async function requestExecutionPreviewAutomation(executionId, database = db, options = {}) {
  if (!dashboardiaPreviewConfigured()) return { status: "SKIPPED", reason: "preview-host-not-configured" };
  const settings = options.settings ?? await getGlobalSettings(database);
  const execution = await database.execution.findUnique({
    where: { id: executionId },
    include: { demand: { include: { project: true } } },
  });
  const manualRestart = Boolean(options.manualRestart);
  const allowedStatus = manualRestart
    ? ["AWAITING_CLIENT", "STOPPED"].includes(execution?.status)
    : execution?.status === "AWAITING_CLIENT";
  if (!execution
    || !allowedStatus
    || execution.closedAt
    || execution.cancelRequestedAt
    || (!manualRestart && execution.stopRequestedAt)
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
  await database.previewEnvironment.update({
    where: { id: environment.id },
    data: { attempts: { increment: 1 } },
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
      },
    });
    await executionLog(database, execution.id, manualRestart
      ? "Ambiente navegável solicitado novamente pelo cliente diretamente da branch, sem acionar a IA."
      : options.infrastructureRetry
        ? "Retentativa interna do ambiente navegável iniciada sem acionar a IA."
        : "Ambiente navegável iniciado automaticamente para esta execução.", "info", {
      automatic: !manualRestart,
      manualRestart,
      aiInvoked: false,
      infrastructureRetry: Boolean(options.infrastructureRetry),
      previewEnvironmentId: environment.id,
      branchName: execution.branchName,
      runtime: runtimeLabel,
    });
    return { status: "QUEUED", previewEnvironmentId: environment.id };
  } catch (error) {
    const technical = redactSensitiveData(error instanceof Error ? error.message : String(error));
    await deleteDashboardiaPreview(environment.id).catch(() => null);
    await transitionPreviewEnvironment(database, environment.id, "FAILED", { error: `[INFRASTRUCTURE] ${technical}` }).catch(() => null);
    await executionLog(database, execution.id, "Falha de infraestrutura — IA não acionada. Não foi possível iniciar o ambiente automático.", "warn", {
      automatic: true,
      aiInvoked: false,
      failureClass: "INFRASTRUCTURE",
      failureSignature: previewFailureSignature(technical),
      technical: technical.slice(-4_000),
    }).catch(() => null);
    return { status: "FAILED", reason: "infrastructure" };
  }
}

async function markTimedOut(preview, settings, database) {
  const timeoutMinutes = Math.max(1, Number(settings.previewPreparationTimeoutMinutes) || 15);
  if (Date.now() - new Date(preview.requestedAt).getTime() < timeoutMinutes * 60_000) return preview;

  await deleteDashboardiaPreview(preview.externalId ?? preview.id).catch(() => null);
  const error = `[INFRASTRUCTURE] O ambiente automático não ficou pronto dentro de ${timeoutMinutes} minutos.`;
  return transitionPreviewEnvironment(database, preview.id, "FAILED", { error }).catch(async () => (
    database.previewEnvironment.update({ where: { id: preview.id }, data: { status: "FAILED", error } })
  ));
}

export async function syncExecutionPreviewAutomations(database = db, options = {}) {
  const settings = options.settings ?? await getGlobalSettings(database);
  const previews = await database.previewEnvironment.findMany({
    where: {
      status: { in: WATCHED_PREVIEW_STATUSES },
      execution: {
        status: { in: ["AWAITING_CLIENT", "STOPPED"] },
        closedAt: null,
        cancelRequestedAt: null,
        demand: { type: { not: "DOCUMENTATION" } },
      },
    },
    orderBy: { requestedAt: "asc" },
    take: 25,
  });

  let requeued = 0;
  for (const preview of previews) {
    if (preview.status === "FAILED") {
      if (await handleFailedPreview(preview, settings, database)) requeued += 1;
      continue;
    }

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
    if (current.status === "READY" && preview.attempts > 0) {
      await database.previewEnvironment.updateMany({
        where: { id: preview.id, status: "READY" },
        data: { attempts: 0 },
      }).catch(() => null);
    }
    if (current.status === "FAILED" && await handleFailedPreview(current, settings, database)) requeued += 1;
  }
  return { checked: previews.length, requeued };
}
