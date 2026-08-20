import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { createGitHubPullRequest, findOpenGitHubPullRequest, getProjectGitHubAccessToken } from "../lib/github.js";
import { getGlobalSettings } from "../lib/global-settings.js";
import { applyDetectedRuntime, detectWorkspaceProjectRuntime } from "../lib/project-runtime.js";
import {
  cleanWorkspace,
  cleanValidationArtifacts,
  gitAuthenticationArgs,
  resolveWorkspacePath,
  restoreImplementationSnapshot,
  runConfiguredCommand,
  runProcess,
} from "./sandbox.mjs";
import { runImplementationPreview, runVisualValidation } from "./visual-validation.mjs";
import { DEFAULT_AI_MODEL } from "../lib/ai-models.js";
import { auditData } from "../lib/audit.js";
import { calculateLiveUsageCredits, saveFinancialSnapshot } from "../lib/financial-shadow.js";
import { getExecutionCreditBudget, settleExecutionCredits } from "../lib/billing.js";
import { getBusinessKnowledgeContext } from "../lib/business-knowledge.js";
import { repositoryHasUsableProject } from "../lib/repository-content.js";
import { buildAgentPrompt, resolveAgentRunPolicy } from "./agent-policy.mjs";
import { remoteFetchRefspec, remoteTrackingRef } from "./git-refs.mjs";

const workspaceRoot = path.join(os.tmpdir(), "forgeboard-workspaces");

class ExecutionCancelledError extends Error {
  constructor() {
    super("Execução cancelada pelo Gestor");
    this.name = "ExecutionCancelledError";
  }
}

class ExecutionStoppedError extends Error {
  constructor() {
    super("Execução interrompida pela pausa global da plataforma");
    this.name = "ExecutionStoppedError";
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const TRANSIENT_AGENT_ERROR_PATTERNS = [
  /an error occurred while processing your request/i,
  /you can retry your request/i,
  /request id req_/i,
  /rate.?limit/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /connection (?:reset|closed|refused)/i,
  /fetch failed/i,
  /socket hang up/i,
  /econnreset/i,
  /etimedout/i,
];

function isTransientAgentError(error) {
  if (error?.code === "CREDIT_BUDGET_EXCEEDED") return false;
  const status = Number(error?.status ?? error?.statusCode);
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  const name = String(error?.name ?? "");
  if (["APIConnectionError", "RateLimitError", "InternalServerError"].includes(name)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return TRANSIENT_AGENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function log(executionId, scope, message, level = "info", metadata) {
  await db.executionLog.create({ data: { executionId, scope, message, level, metadata } });
}

async function saveReviewDiff(database, executionId, diffContent) {
  await database.executionArtifact.deleteMany({ where: { executionId, type: "diff" } });
  await database.executionArtifact.create({
    data: {
      executionId,
      type: "diff",
      name: "changes.diff",
      content: String(diffContent ?? "").slice(0, 200_000),
    },
  });
}

async function assertExecutionActive(executionId) {
  const current = await db.execution.findUnique({ where: { id: executionId }, select: { cancelRequestedAt: true, stopRequestedAt: true } });
  if (current?.stopRequestedAt) throw new ExecutionStoppedError();
  if (current?.cancelRequestedAt) throw new ExecutionCancelledError();
}

function startImplementationAgent({ projectDirectory, prompt, model, policy, creditBudget, creditBudgetContext, creditCostPolicy }) {
  const child = fork(new URL("./implementation-runner.mjs", import.meta.url), [], {
    env: process.env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  let settled = false;
  let forceKillTimer;
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-12_000); });

  const promise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.on("message", (message) => {
      if (message?.type === "result") {
        settled = true;
        resolve(message.result);
      } else if (message?.type === "error") {
        settled = true;
        const error = new Error(message.error?.message || "O subprocesso do agente falhou");
        Object.assign(error, message.error);
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(forceKillTimer);
      if (!settled) reject(new Error(stderr || `O subprocesso do agente foi encerrado (${signal || code})`));
    });
    child.send({ type: "run", projectDirectory, prompt, model, policy, creditBudget, creditBudgetContext, creditCostPolicy });
  });

  return {
    promise,
    abort() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.send({ type: "abort" }, () => null);
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forceKillTimer.unref();
    },
  };
}

async function runValidations(execution, projectDirectory, settings, scopes = ["install", "lint", "test", "build"], warnIfEmpty = true) {
  const commands = [
    ["install", execution.demand.project.installCommand],
    ["lint", execution.demand.project.lintCommand],
    ["test", execution.demand.project.testCommand],
    ["build", execution.demand.project.buildCommand],
  ].filter(([scope, command]) => scopes.includes(scope) && command?.trim());

  if (!commands.length) {
    if (warnIfEmpty) await log(execution.id, "validation", "Nenhum comando de validação foi configurado", "warn");
    return { passed: true };
  }

  for (const [scope, command] of commands) {
    await assertExecutionActive(execution.id);
    await log(execution.id, scope, `Executando: ${command}`);
    const commandController = new AbortController();
    const cancellationTimer = setInterval(async () => {
      const current = await db.execution.findUnique({
        where: { id: execution.id },
        select: { cancelRequestedAt: true, stopRequestedAt: true },
      }).catch(() => null);
      if ((current?.cancelRequestedAt || current?.stopRequestedAt) && !commandController.signal.aborted) {
        commandController.abort();
      }
    }, 2_000);
    cancellationTimer.unref();

    try {
      const result = await runConfiguredCommand(command, projectDirectory, settings.commandTimeoutMinutes * 60_000, commandController.signal, settings.nodeMemoryMb);
      await log(execution.id, scope, `${scope} concluído`, "info", {
        stdout: result.stdout.slice(-12_000),
        stderr: result.stderr.slice(-6_000),
      });
    } catch (error) {
      const current = await db.execution.findUnique({ where: { id: execution.id }, select: { stopRequestedAt: true } }).catch(() => null);
      if (current?.stopRequestedAt) throw new ExecutionStoppedError();
      await assertExecutionActive(execution.id);
      const stdout = String(error?.stdout ?? "").slice(-12_000);
      const stderr = String(error?.stderr ?? "").slice(-12_000);
      const errorMessage = error instanceof Error ? error.message : String(error ?? "Falha desconhecida");
      const technical = [stderr, stdout, errorMessage].filter((value, index, values) => value && values.indexOf(value) === index).join("\n").slice(-20_000);
      await log(execution.id, scope, `${scope} falhou`, "error", {
        command,
        exitCode: error?.code ?? null,
        stdout: stdout || "(sem saída padrão)",
        stderr: stderr || errorMessage || "(sem saída de erro)",
      });
      await log(execution.id, "validation", `A validação ${scope} falhou; a branch e o diff ainda serão gerados para revisão`, "warn", {
        failedScope: scope,
        technical: technical || "O processo terminou sem fornecer detalhes técnicos",
      });
      return { passed: false, failedScope: scope, technical };
    } finally {
      clearInterval(cancellationTimer);
    }
    await assertExecutionActive(execution.id);
  }
  return { passed: true };
}

export async function processExecution(executionId, workerId) {
  const workspace = path.join(workspaceRoot, executionId);
  const runStartedAt = new Date();
  let execution;
  let settings;
  let measuredUsage;
  let inputTokens;
  let outputTokens;
  let runInputTokens = 0;
  let runOutputTokens = 0;
  let visualValidationPerformed = false;

  try {
    settings = await getGlobalSettings();
    execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { include: { project: true } }, pullRequest: true, financialSnapshot: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    inputTokens = Math.max(0, execution.inputTokens ?? 0);
    outputTokens = Math.max(0, execution.outputTokens ?? 0);
    if (execution.inputTokens != null && execution.outputTokens != null) measuredUsage = { inputTokens, outputTokens };
    const addMeasuredUsage = (usage) => {
      const addedInputTokens = Math.max(0, Number(usage?.inputTokens) || 0);
      const addedOutputTokens = Math.max(0, Number(usage?.outputTokens) || 0);
      inputTokens += addedInputTokens;
      outputTokens += addedOutputTokens;
      runInputTokens += addedInputTokens;
      runOutputTokens += addedOutputTokens;
      measuredUsage = { inputTokens, outputTokens };
    };
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada no worker");
    await mkdir(workspaceRoot, { recursive: true });
    await cleanWorkspace(workspace);
    await assertExecutionActive(executionId);
    await log(executionId, "workspace", "Preparando cópia isolada do repositório");

    const token = await getProjectGitHubAccessToken(execution.demand.project, execution.requestedById);
    const repositoryUrl = `https://github.com/${execution.demand.project.repositoryFullName}.git`;
    const authenticationArgs = gitAuthenticationArgs(token);
    const isFollowUp = Boolean(execution.pullRequest && execution.branchName && execution.messages.some((message) => message.role === "USER"));
    const sourceBranch = isFollowUp ? execution.branchName : execution.demand.project.defaultBranch;
    await runProcess("git", [
      ...authenticationArgs,
      "clone",
      "--depth",
      "50",
      "--no-single-branch",
      "--branch",
      sourceBranch,
      repositoryUrl,
      workspace,
    ], { cwd: workspaceRoot, timeout: 5 * 60_000, secrets: [token, authenticationArgs[1]] });

    const trackedFiles = (await runProcess("git", ["ls-files"], { cwd: workspace })).stdout
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
    if (!repositoryHasUsableProject(trackedFiles)) {
      throw new Error(`A branch ${sourceBranch} não contém arquivos de um projeto que o agente possa alterar. Faça merge do Pull Request que contém o código na branch principal e tente novamente. Nenhum crédito foi cobrado.`);
    }

    const branchName = isFollowUp ? execution.branchName : `forgeboard/demand-${execution.demandId.slice(-8)}-${execution.id.slice(-6)}`;
    const documentationOnly = execution.demand.type === "DOCUMENTATION";
    const agentLabel = documentationOnly ? "Agente de documentação" : "Agente de implementação";
    if (!isFollowUp) await runProcess("git", ["checkout", "-b", branchName], { cwd: workspace });
    await runProcess("git", [...authenticationArgs, "fetch", "origin", remoteFetchRefspec(execution.demand.project.defaultBranch)], { cwd: workspace, timeout: 5 * 60_000, secrets: [token, authenticationArgs[1]] });
    const projectDirectory = resolveWorkspacePath(workspace, execution.demand.project.workingDirectory);
    const selectedModel = execution.model ?? env.OPENAI_MODEL ?? DEFAULT_AI_MODEL;
    execution.model = selectedModel;
    const approvedKnowledge = await getBusinessKnowledgeContext(db, {
      ownerUserId: execution.demand.project.createdById,
      projectId: execution.demand.project.id,
    });
    const promptOptions = { businessKnowledge: approvedKnowledge.context };
    await db.execution.update({
      where: { id: executionId },
      data: { status: "RUNNING", stage: documentationOnly ? "ANALYSIS" : "IMPLEMENTATION", branchName, model: selectedModel },
    });
    await log(executionId, "agent", `${agentLabel} iniciado`);
    if (approvedKnowledge.entries.length > 0) {
      await log(executionId, "agent", `${approvedKnowledge.entries.length} regra(s) de negócio aprovada(s) carregada(s) para esta execução`);
    }

    let abortReason = null;
    const agentPolicy = resolveAgentRunPolicy({
      demand: execution.demand,
      model: selectedModel,
      configuredTimeoutMinutes: settings.agentTimeoutMinutes,
      powerMode: settings.agentPowerMode,
    });
    const creditBudgetContext = await getExecutionCreditBudget(db, {
      executionId,
      marginPercent: settings.creditBalanceSafetyMarginPercent,
    });
    const creditBudget = creditBudgetContext?.hardLimitCredits ?? null;
    await log(executionId, "agent", `Escopo ${agentPolicy.scope === "COMPLEX" ? "amplo" : "padrão"} detectado`, "info", {
      maxTurns: agentPolicy.maxTurns,
      timeoutMinutes: agentPolicy.timeoutMinutes,
    });
    const creditCostPolicy = creditBudget != null ? {
      model: selectedModel,
      usdToBrlCents: settings.usdToBrlCents,
      aiSafetyPercent: settings.aiSafetyPercent,
      creditValueCents: settings.creditValueCents,
      targetGrossMarginPercent: settings.targetGrossMarginPercent,
    } : null;
    const conversationContext = isFollowUp
      ? execution.messages.map((message) => `${message.role === "USER" ? "Cliente" : message.role === "AGENT" ? "Agente" : "Sistema"}: ${message.content}`).join("\n\n")
      : "";
    const agentPrompt = isFollowUp
      ? [
          "Continue a execução já entregue na branch atual e no mesmo Pull Request.",
          "Aplique o ajuste solicitado pelo cliente preservando todas as decisões e alterações anteriores.",
          "Não recrie o projeto nem reverta trabalho válido. Inspecione o estado atual antes de editar.",
          buildAgentPrompt(execution.demand, agentPolicy.scope, promptOptions),
          `Interações desta execução:\n${conversationContext}`,
        ].join("\n\n")
      : buildAgentPrompt(execution.demand, agentPolicy.scope, promptOptions);
    const createImplementationAgent = () => startImplementationAgent({
      projectDirectory,
      prompt: agentPrompt,
      model: selectedModel,
      policy: agentPolicy,
      creditBudget,
      creditBudgetContext,
      creditCostPolicy,
    });
    let implementationAgent = createImplementationAgent();
    const cancellationTimer = setInterval(async () => {
      const current = await db.execution.findUnique({
        where: { id: executionId },
        select: { cancelRequestedAt: true, stopRequestedAt: true },
      }).catch(() => null);
      if (current?.stopRequestedAt && !abortReason) {
        abortReason = "stopped";
        implementationAgent.abort();
      } else if (current?.cancelRequestedAt && !abortReason) {
        abortReason = "cancelled";
        implementationAgent.abort();
      }
    }, 2_000);
    cancellationTimer.unref();

    const agentTimeout = setTimeout(() => {
      if (!abortReason) {
        abortReason = "timeout";
        implementationAgent.abort();
      }
    }, agentPolicy.timeoutMinutes * 60_000);
    agentTimeout.unref();

    let summary;
    try {
      const maxAgentAttempts = 3;
      for (let attempt = 1; attempt <= maxAgentAttempts; attempt += 1) {
        try {
          const result = await implementationAgent.promise;
          summary = result.summary;
          addMeasuredUsage(result);
          break;
        } catch (error) {
          if (error?.inputTokens != null && error?.outputTokens != null) {
            addMeasuredUsage(error);
          }
          if (abortReason === "stopped") throw new ExecutionStoppedError();
          if (abortReason === "cancelled") throw new ExecutionCancelledError();
          if (abortReason === "timeout") {
            throw new Error(`${documentationOnly ? "A documentação" : "A implementação"} excedeu o limite de ${agentPolicy.timeoutMinutes} minutos. Revise o escopo da demanda ou tente novamente.`);
          }
          if (attempt >= maxAgentAttempts || !isTransientAgentError(error)) throw error;

          const retryDelayMs = attempt === 1 ? 3_000 : 10_000;
          await log(executionId, "agent", `Falha temporária no provedor de IA; nova tentativa automática ${attempt + 1}/${maxAgentAttempts}`, "warn", {
            retryInSeconds: retryDelayMs / 1_000,
            technical: error instanceof Error ? error.message : String(error),
          });
          await wait(retryDelayMs);
          if (abortReason === "stopped") throw new ExecutionStoppedError();
          if (abortReason === "cancelled") throw new ExecutionCancelledError();
          if (abortReason === "timeout") {
            throw new Error(`${documentationOnly ? "A documentação" : "A implementação"} excedeu o limite de ${agentPolicy.timeoutMinutes} minutos. Revise o escopo da demanda ou tente novamente.`);
          }
          await assertExecutionActive(executionId);
          implementationAgent = createImplementationAgent();
        }
      }
    } finally {
      clearInterval(cancellationTimer);
      clearTimeout(agentTimeout);
    }

    await log(executionId, "agent", `${agentLabel} concluído`);
    await assertExecutionActive(executionId);

    const statusResult = await runProcess("git", ["status", "--porcelain"], { cwd: workspace });
    if (!statusResult.stdout.trim()) {
      if (isFollowUp) {
        const expiresAt = new Date(Date.now() + settings.executionConversationTimeoutMinutes * 60_000);
        const finishedAt = new Date();
        await db.$transaction(async (transaction) => {
          await transaction.execution.update({ where: { id: executionId }, data: { status: "AWAITING_CLIENT", stage: "PUBLISH", summary, inputTokens, outputTokens, lockedAt: null, lockedBy: null, conversationExpiresAt: expiresAt, lastInteractionAt: new Date() } });
          const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt, runStartedAt, previousSnapshot: execution.financialSnapshot, visualValidationPerformed });
          await settleExecutionCredits(transaction, { executionId, consumedCredits: snapshot.simulatedConsumedCredits });
          await transaction.executionMessage.create({ data: { executionId, role: "AGENT", content: summary || "Revisei o pedido, mas ele não exigiu alterações adicionais no código." } });
        });
        await log(executionId, "agent", "Interação concluída sem novas alterações no código");
        return;
      }
      if (!["INVESTIGATION", "DOCUMENTATION"].includes(execution.demand.type)) throw new Error("A IA não produziu alterações no repositório");
      const finishedAt = new Date();
      await db.$transaction(async (transaction) => {
        const updated = await transaction.execution.updateMany({
          where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
          data: { status: "SUCCEEDED", stage: "ANALYSIS", summary, inputTokens, outputTokens, lockedAt: null, lockedBy: null, finishedAt },
        });
        if (updated.count !== 1) throw new ExecutionCancelledError();
        const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt, runStartedAt, previousSnapshot: execution.financialSnapshot, visualValidationPerformed });
        await settleExecutionCredits(transaction, { executionId, consumedCredits: snapshot.simulatedConsumedCredits });
        await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "SUCCEEDED" } });
      });
      return;
    }

    // Congele somente o trabalho do agente antes que install/test/build/preview
    // possam alterar arquivos versionados ou criar artefatos no repositório.
    await runProcess("git", ["add", "-A"], { cwd: workspace });
    await runProcess("git", ["-c", "user.name=Forgeboard", "-c", "user.email=forgeboard@users.noreply.github.com", "commit", "-m", `forgeboard: ${execution.demand.title.slice(0, 120)}`], { cwd: workspace });
    let implementationHead = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    const base = (await runProcess("git", ["rev-parse", remoteTrackingRef(execution.demand.project.defaultBranch)], { cwd: workspace })).stdout.trim();

    await db.execution.update({ where: { id: executionId }, data: { status: "VALIDATING", stage: "VALIDATION" } });

    // Use sempre a configuração mais recente salva no cadastro do projeto.
    const savedProject = await db.project.findUniqueOrThrow({
      where: { id: execution.demand.projectId },
    });
    const detectedRuntime = await detectWorkspaceProjectRuntime(projectDirectory);
    const resolvedProject = applyDetectedRuntime(savedProject, detectedRuntime);
    const runtimeFields = ["installCommand", "lintCommand", "testCommand", "buildCommand", "previewCommand", "previewPort"];
    const detectedConfiguration = Object.fromEntries(runtimeFields
      .filter((field) => savedProject[field] == null && resolvedProject[field] != null)
      .map((field) => [field, resolvedProject[field]]));
    if (Object.keys(detectedConfiguration).length) {
      await db.project.update({ where: { id: savedProject.id }, data: detectedConfiguration });
      await log(executionId, "validation", `Configuração ${detectedRuntime.runtime} detectada após a implementação`, "info", detectedConfiguration);
    }
    execution.demand.project = { ...savedProject, ...detectedConfiguration };
    let validationResult = await runValidations(execution, projectDirectory, settings);
    if (!validationResult.passed) {
      const consumedBeforeRepair = creditCostPolicy
        ? calculateLiveUsageCredits({ ...creditCostPolicy, inputTokens: runInputTokens, outputTokens: runOutputTokens })
        : 0;
      const remainingCreditBudget = creditBudget == null ? null : Math.max(0, creditBudget - consumedBeforeRepair);
      if (remainingCreditBudget == null || remainingCreditBudget > 0) {
        await cleanValidationArtifacts(projectDirectory);
        await restoreImplementationSnapshot(workspace, implementationHead);
        await log(executionId, "validation", "Agente de correção automática iniciado com o erro real da validação", "warn", {
          failedScope: validationResult.failedScope,
        });
        const repairPolicy = {
          ...agentPolicy,
          maxTurns: Math.min(agentPolicy.maxTurns, 24),
          maxTokens: Math.min(agentPolicy.maxTokens, 20_000),
          timeoutMinutes: Math.min(agentPolicy.timeoutMinutes, 10),
        };
        const repairAgent = startImplementationAgent({
          projectDirectory,
          prompt: [
            "A implementação abaixo já foi realizada, mas a validação automática falhou.",
            "Inspecione os arquivos relacionados ao erro e aplique somente as correções necessárias para a validação passar, sem remover funcionalidades nem alterar o escopo aprovado.",
            "Use exclusivamente apply_patch. Não execute build, lint, instalação ou testes; o worker validará novamente.",
            `Etapa que falhou: ${validationResult.failedScope}`,
            `Saída técnica da validação:\n${validationResult.technical}`,
            `Demanda original:\n${buildAgentPrompt(execution.demand, agentPolicy.scope, promptOptions)}`,
          ].join("\n\n"),
          model: selectedModel,
          policy: repairPolicy,
          creditBudget: remainingCreditBudget,
          creditBudgetContext,
          creditCostPolicy,
        });
        const repairTimeout = setTimeout(() => repairAgent.abort(), repairPolicy.timeoutMinutes * 60_000);
        repairTimeout.unref();
        let repairCompleted = false;
        try {
          const repairResult = await repairAgent.promise;
          addMeasuredUsage(repairResult);
          repairCompleted = true;
        } catch (repairError) {
          if (repairError?.inputTokens != null && repairError?.outputTokens != null) addMeasuredUsage(repairError);
          await cleanValidationArtifacts(projectDirectory);
          await restoreImplementationSnapshot(workspace, implementationHead);
          await log(executionId, "validation", "A correção automática não foi concluída; a implementação original continuará disponível para revisão", "warn", {
            technical: repairError instanceof Error ? repairError.message : String(repairError),
          });
        } finally {
          clearTimeout(repairTimeout);
        }
        await assertExecutionActive(executionId);
        const repairStatus = repairCompleted
          ? await runProcess("git", ["status", "--porcelain"], { cwd: workspace })
          : { stdout: "" };
        if (repairCompleted && repairStatus.stdout.trim()) {
          await runProcess("git", ["add", "-A"], { cwd: workspace });
          await runProcess("git", ["-c", "user.name=Forgeboard", "-c", "user.email=forgeboard@users.noreply.github.com", "commit", "--amend", "--no-edit"], { cwd: workspace });
          implementationHead = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
          await log(executionId, "validation", "Correção automática aplicada; executando a validação novamente");
          validationResult = await runValidations(execution, projectDirectory, settings);
        } else if (repairCompleted) {
          await log(executionId, "validation", "O agente não encontrou uma correção aplicável para a falha", "warn");
        }
      }
    }

    let visualArtifacts = [];
    if (execution.demand.visualValidation) {
      await assertExecutionActive(executionId);
      await log(executionId, "visual", "Validação visual iniciada");
      visualValidationPerformed = true;
      try {
        visualArtifacts = await runVisualValidation({
          execution,
          projectDirectory,
          log: (scope, message, level, metadata) => log(executionId, scope, message, level, metadata),
        });
        await log(executionId, "visual", `${visualArtifacts.length} evidências visuais geradas`);
      } catch (visualError) {
        const technical = visualError instanceof Error ? visualError.message : String(visualError);
        await log(executionId, "visual", "A validação visual falhou; a branch e o diff ainda serão gerados para revisão", "warn", { technical });
      }
      await assertExecutionActive(executionId);
    } else {
      if (execution.demand.project.previewCommand && execution.demand.project.previewPort) {
        await log(executionId, "visual", "Gerando preview visual automático da implementação");
        try {
          visualArtifacts = await runImplementationPreview({
            execution,
            projectDirectory,
            log: (scope, message, level, metadata) => log(executionId, scope, message, level, metadata),
          });
          await log(executionId, "visual", "Preview visual automático gerado");
        } catch (previewError) {
          await log(executionId, "visual", "Não foi possível gerar o preview visual automático; a revisão do código continuará disponível", "warn", {
            technical: previewError instanceof Error ? previewError.message : String(previewError),
          });
        }
        await assertExecutionActive(executionId);
      }
    }
    await cleanValidationArtifacts(projectDirectory);
    await restoreImplementationSnapshot(workspace, implementationHead);
    let diffResult = await runProcess("git", ["diff", "--binary", base, implementationHead], { cwd: workspace });
    await runProcess("git", [...authenticationArgs, "push", "-u", "origin", branchName], { cwd: workspace, timeout: 5 * 60_000, secrets: [token, authenticationArgs[1]] });
    await db.execution.updateMany({
      where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
      data: { branchName, baseSha: base, headSha: implementationHead },
    });
    await saveReviewDiff(db, executionId, diffResult.stdout);
    await log(executionId, "publish", "Branch, diff e evidências disponíveis para revisão", "info", {
      branchName,
      headSha: implementationHead,
    });

    let publishedPullRequest = execution.pullRequest;
    if (!publishedPullRequest) {
      await log(executionId, "publish", "Abrindo Pull Request automaticamente");
      const existingPullRequest = await findOpenGitHubPullRequest(
        token,
        execution.demand.project.repositoryFullName,
        branchName,
        execution.demand.project.defaultBranch,
      );
      const body = [
        `## Demanda\n${execution.demand.description}`,
        execution.demand.acceptanceCriteria ? `## Critérios de aceite\n${execution.demand.acceptanceCriteria}` : null,
        summary ? `## Resultado da execução\n${summary}` : null,
        "---\nPull Request criado automaticamente pelo Dashboard IA. Novos ajustes podem ser enviados pelo chat da execução.",
      ].filter(Boolean).join("\n\n");
      const githubPullRequest = existingPullRequest ?? await createGitHubPullRequest(
        token,
        execution.demand.project.repositoryFullName,
        {
          title: execution.demand.title,
          body,
          head: branchName,
          base: execution.demand.project.defaultBranch,
          draft: true,
        },
      );
      publishedPullRequest = {
        externalNumber: githubPullRequest.number,
        url: githubPullRequest.html_url,
        title: githubPullRequest.title,
        status: githubPullRequest.draft ? "DRAFT" : "OPEN",
        headBranch: branchName,
        baseBranch: execution.demand.project.defaultBranch,
        recovered: Boolean(existingPullRequest),
      };
    }

    await db.$transaction(async (transaction) => {
      const pullRequest = execution.pullRequest ?? await transaction.pullRequest.upsert({
        where: { executionId },
        update: {
          externalNumber: publishedPullRequest.externalNumber,
          url: publishedPullRequest.url,
          title: publishedPullRequest.title,
          status: publishedPullRequest.status,
          headBranch: publishedPullRequest.headBranch,
          baseBranch: publishedPullRequest.baseBranch,
        },
        create: {
          executionId,
          projectId: execution.demand.projectId,
          demandId: execution.demandId,
          externalNumber: publishedPullRequest.externalNumber,
          url: publishedPullRequest.url,
          title: publishedPullRequest.title,
          status: publishedPullRequest.status,
          headBranch: publishedPullRequest.headBranch,
          baseBranch: publishedPullRequest.baseBranch,
        },
      });
      const updated = await transaction.execution.updateMany({
        where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
        data: {
          status: "AWAITING_CLIENT",
          stage: "PUBLISH",
          summary,
          baseSha: base,
          headSha: implementationHead,
          inputTokens,
          outputTokens,
          lockedAt: null,
          lockedBy: null,
          conversationExpiresAt: new Date(Date.now() + settings.executionConversationTimeoutMinutes * 60_000),
          lastInteractionAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new ExecutionCancelledError();
      const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, runStartedAt, previousSnapshot: execution.financialSnapshot, visualValidationPerformed });
      await settleExecutionCredits(transaction, { executionId, consumedCredits: snapshot.simulatedConsumedCredits });
      await saveReviewDiff(transaction, executionId, diffResult.stdout);
      await transaction.executionArtifact.deleteMany({ where: { executionId, type: "validation" } });
      await transaction.executionArtifact.create({
        data: {
          executionId,
          type: "validation",
          name: "validation-summary.json",
          content: JSON.stringify({
            passed: validationResult.passed,
            failedScope: validationResult.failedScope ?? null,
            technical: validationResult.technical ?? null,
            generatedAt: new Date().toISOString(),
          }, null, 2),
        },
      });
      if (visualArtifacts.length) await transaction.executionArtifact.createMany({ data: visualArtifacts.map((artifact) => ({ executionId, ...artifact })) });
      if (isFollowUp) await transaction.executionMessage.create({ data: { executionId, role: "AGENT", content: summary || "Ajuste aplicado na mesma branch e no Pull Request existente." } });
      else {
        await transaction.executionMessage.create({ data: { executionId, role: "SYSTEM", content: `Pull Request #${pullRequest.externalNumber} aberto automaticamente. Revise o resultado e envie qualquer ajuste diretamente neste chat. Quando estiver tudo certo, conclua a execução.` } });
        await transaction.auditLog.create({ data: auditData({
          actorId: execution.requestedById,
          projectId: execution.demand.projectId,
          action: "pull_request.create",
          entityType: "PullRequest",
          entityId: pullRequest.id,
          metadata: { externalNumber: pullRequest.externalNumber, automatic: true, recovered: publishedPullRequest.recovered },
        }) });
      }
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "REVIEW" } });
    });
    await log(executionId, "publish", isFollowUp ? `Ajuste enviado para o Pull Request #${publishedPullRequest.externalNumber}; aguardando o cliente` : `Pull Request #${publishedPullRequest.externalNumber} aberto automaticamente; aguardando o cliente`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na execução";
    const cancelled = error instanceof ExecutionCancelledError;
    const stopped = error instanceof ExecutionStoppedError;
    const finishedAt = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.execution.update({ where: { id: executionId }, data: { status: stopped ? "STOPPED" : cancelled ? "CANCELLED" : "FAILED", error: stopped || cancelled ? null : message, inputTokens, outputTokens, lockedAt: null, lockedBy: null, finishedAt } });
      if (execution && settings) {
        if (stopped) await settleExecutionCredits(transaction, { executionId, consumedCredits: 0 });
        else {
          const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt, runStartedAt, previousSnapshot: execution.financialSnapshot, visualValidationPerformed });
          await settleExecutionCredits(transaction, { executionId, consumedCredits: snapshot.simulatedConsumedCredits });
        }
      }
    }).catch(() => null);
    if (execution?.demandId) await db.demand.update({ where: { id: execution.demandId }, data: { status: stopped ? "STOPPED" : cancelled ? "APPROVED" : "FAILED" } }).catch(() => null);
    await log(executionId, "worker", message, stopped || cancelled ? "warn" : "error", stopped || cancelled ? undefined : {
      code: error?.code ?? null,
      stdout: String(error?.stdout ?? "").slice(-12_000) || "(sem saída padrão)",
      stderr: String(error?.stderr ?? "").slice(-12_000) || message,
    }).catch(() => null);
    if (!cancelled && !stopped) throw error;
  } finally {
    await cleanWorkspace(workspace).catch(() => null);
    console.log(`[worker:${workerId}] execução ${executionId} finalizada`);
  }
}
