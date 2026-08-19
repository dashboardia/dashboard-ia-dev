import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { getProjectGitHubAccessToken } from "../lib/github.js";
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
import { publishDashboardiaPreview } from "./preview-publisher.mjs";
import { getDashboardiaPreview } from "../lib/preview-host-client.js";
import { DEFAULT_AI_MODEL } from "../lib/ai-models.js";
import { calculateLiveUsageCredits, saveFinancialSnapshot } from "../lib/financial-shadow.js";
import { getExecutionCreditBudget, settleExecutionCredits } from "../lib/billing.js";
import { buildAgentPrompt, resolveAgentRunPolicy } from "./agent-policy.mjs";

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

const PREVIEW_TERMINAL_STATES = new Set(["READY", "FAILED", "EXPIRED"]);

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

async function waitForPreviewOutcome(previewId, timeoutMs = 210_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getDashboardiaPreview(previewId);
    if (PREVIEW_TERMINAL_STATES.has(latest?.status)) return latest;
    await wait(3_000);
  }
  return latest;
}

async function log(executionId, scope, message, level = "info", metadata) {
  await db.executionLog.create({ data: { executionId, scope, message, level, metadata } });
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
  let execution;
  let settings;
  let measuredUsage;

  try {
    settings = await getGlobalSettings();
    execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { include: { project: true } } },
    });
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada no worker");
    await mkdir(workspaceRoot, { recursive: true });
    await cleanWorkspace(workspace);
    await assertExecutionActive(executionId);
    await log(executionId, "workspace", "Preparando cópia isolada do repositório");

    const token = await getProjectGitHubAccessToken(execution.demand.project, execution.requestedById);
    const repositoryUrl = `https://github.com/${execution.demand.project.repositoryFullName}.git`;
    const authenticationArgs = gitAuthenticationArgs(token);
    await runProcess("git", [
      ...authenticationArgs,
      "clone",
      "--depth",
      "50",
      "--single-branch",
      "--branch",
      execution.demand.project.defaultBranch,
      repositoryUrl,
      workspace,
    ], { cwd: workspaceRoot, timeout: 5 * 60_000, secrets: [token, authenticationArgs[1]] });

    const branchName = `forgeboard/demand-${execution.demandId.slice(-8)}-${execution.id.slice(-6)}`;
    const documentationOnly = execution.demand.type === "DOCUMENTATION";
    const agentLabel = documentationOnly ? "Agente de documentação" : "Agente de implementação";
    await runProcess("git", ["checkout", "-b", branchName], { cwd: workspace });
    const projectDirectory = resolveWorkspacePath(workspace, execution.demand.project.workingDirectory);
    const selectedModel = execution.model ?? env.OPENAI_MODEL ?? DEFAULT_AI_MODEL;
    execution.model = selectedModel;
    await db.execution.update({
      where: { id: executionId },
      data: { status: "RUNNING", stage: documentationOnly ? "ANALYSIS" : "IMPLEMENTATION", branchName, model: selectedModel },
    });
    await log(executionId, "agent", `${agentLabel} iniciado`);

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
    const creditCostPolicy = creditBudget ? {
      model: selectedModel,
      usdToBrlCents: settings.usdToBrlCents,
      aiSafetyPercent: settings.aiSafetyPercent,
      creditValueCents: settings.creditValueCents,
      targetGrossMarginPercent: settings.targetGrossMarginPercent,
    } : null;
    const createImplementationAgent = () => startImplementationAgent({
      projectDirectory,
      prompt: buildAgentPrompt(execution.demand, agentPolicy.scope),
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
    let inputTokens;
    let outputTokens;
    try {
      const maxAgentAttempts = 3;
      for (let attempt = 1; attempt <= maxAgentAttempts; attempt += 1) {
        try {
          const result = await implementationAgent.promise;
          summary = result.summary;
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
          measuredUsage = { inputTokens, outputTokens };
          break;
        } catch (error) {
          if (error?.inputTokens != null && error?.outputTokens != null) {
            measuredUsage = { inputTokens: error.inputTokens, outputTokens: error.outputTokens };
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
      if (!["INVESTIGATION", "DOCUMENTATION"].includes(execution.demand.type)) throw new Error("A IA não produziu alterações no repositório");
      const finishedAt = new Date();
      await db.$transaction(async (transaction) => {
        const updated = await transaction.execution.updateMany({
          where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
          data: { status: "SUCCEEDED", stage: "ANALYSIS", summary, inputTokens, outputTokens, lockedAt: null, lockedBy: null, finishedAt },
        });
        if (updated.count !== 1) throw new ExecutionCancelledError();
        const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt });
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
    const base = (await runProcess("git", ["rev-parse", execution.demand.project.defaultBranch], { cwd: workspace })).stdout.trim();

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
      const consumedBeforeRepair = creditCostPolicy && measuredUsage
        ? calculateLiveUsageCredits({ ...creditCostPolicy, ...measuredUsage })
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
            `Demanda original:\n${buildAgentPrompt(execution.demand, agentPolicy.scope)}`,
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
          inputTokens = (inputTokens ?? 0) + (repairResult.inputTokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (repairResult.outputTokens ?? 0);
          measuredUsage = { inputTokens, outputTokens };
          repairCompleted = true;
        } catch (repairError) {
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
    // A API de preview precisa conhecer a branch e o commit assim que eles
    // existem. A liquidação e a transição para revisão continuam atômicas no
    // encerramento, mas o ambiente navegável não deve depender desse passo.
    await db.execution.updateMany({
      where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
      data: { branchName, baseSha: base, headSha: implementationHead },
    });

    if (!documentationOnly) {
      if (!validationResult.passed) {
        await log(executionId, "preview", "A validação local falhou; o host de preview tentará compilar o projeto em seu ambiente isolado", "warn", {
          failedScope: validationResult.failedScope,
          technical: validationResult.technical,
        });
      }
      let remotePreview = await publishDashboardiaPreview({
        database: db,
        execution,
        projectDirectory,
        runtime: detectedRuntime.runtime,
        log: (scope, message, level, metadata) => log(executionId, scope, message, level, metadata),
      });
      let previewOutcome = remotePreview
        ? await waitForPreviewOutcome(remotePreview.id).catch((error) => ({ status: "FAILED", error: error instanceof Error ? error.message : String(error) }))
        : null;

      if (previewOutcome?.status === "READY") {
        await log(executionId, "preview", "Ambiente temporário iniciado e validado com sucesso", "info", {
          previewId: previewOutcome.id,
          url: previewOutcome.url,
        });
      } else if (previewOutcome?.status === "FAILED") {
        const consumedBeforePreviewRepair = creditCostPolicy && measuredUsage
          ? calculateLiveUsageCredits({ ...creditCostPolicy, ...measuredUsage })
          : 0;
        const remainingCreditBudget = creditBudget == null ? null : Math.max(0, creditBudget - consumedBeforePreviewRepair);
        if (remainingCreditBudget == null || remainingCreditBudget > 0) {
          const previewTechnical = String(previewOutcome.error || "O container falhou durante a inicialização").slice(-20_000);
          await log(executionId, "preview", "O container falhou ao iniciar; o agente recebeu o erro real para uma correção automática", "warn", {
            previewId: previewOutcome.id,
            technical: previewTechnical,
          });
          const previewRepairPolicy = {
            ...agentPolicy,
            maxTurns: Math.min(agentPolicy.maxTurns, 24),
            maxTokens: Math.min(agentPolicy.maxTokens, 20_000),
            timeoutMinutes: Math.min(agentPolicy.timeoutMinutes, 10),
          };
          const previewRepairAgent = startImplementationAgent({
            projectDirectory,
            prompt: [
              "A implementação já foi concluída, mas a aplicação falhou ao iniciar no container temporário de preview.",
              "Investigue a saída real de inicialização abaixo e aplique somente as correções necessárias para a aplicação compilar, iniciar e responder pela porta configurada.",
              "Preserve integralmente o escopo aprovado. Corrija também dados de demonstração, migrações ou configuração quando forem a causa da falha.",
              "Use exclusivamente apply_patch. Não execute build, instalação, testes, servidor ou Docker; o host de preview fará a validação novamente.",
              `Saída técnica do container:\n${previewTechnical}`,
              `Demanda original:\n${buildAgentPrompt(execution.demand, agentPolicy.scope)}`,
            ].join("\n\n"),
            model: selectedModel,
            policy: previewRepairPolicy,
            creditBudget: remainingCreditBudget,
            creditBudgetContext,
            creditCostPolicy,
          });
          const previewRepairTimeout = setTimeout(() => previewRepairAgent.abort(), previewRepairPolicy.timeoutMinutes * 60_000);
          previewRepairTimeout.unref();
          let previewRepairCompleted = false;
          try {
            const repairResult = await previewRepairAgent.promise;
            inputTokens = (inputTokens ?? 0) + (repairResult.inputTokens ?? 0);
            outputTokens = (outputTokens ?? 0) + (repairResult.outputTokens ?? 0);
            measuredUsage = { inputTokens, outputTokens };
            previewRepairCompleted = true;
          } catch (repairError) {
            await restoreImplementationSnapshot(workspace, implementationHead);
            await log(executionId, "preview", "A correção automática do preview não foi concluída; as evidências visuais foram preservadas", "warn", {
              technical: repairError instanceof Error ? repairError.message : String(repairError),
            });
          } finally {
            clearTimeout(previewRepairTimeout);
          }

          await assertExecutionActive(executionId);
          const previewRepairStatus = previewRepairCompleted
            ? await runProcess("git", ["status", "--porcelain"], { cwd: workspace })
            : { stdout: "" };
          if (previewRepairCompleted && previewRepairStatus.stdout.trim()) {
            await runProcess("git", ["add", "-A"], { cwd: workspace });
            await runProcess("git", ["-c", "user.name=Forgeboard", "-c", "user.email=forgeboard@users.noreply.github.com", "commit", "--amend", "--no-edit"], { cwd: workspace });
            implementationHead = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
            diffResult = await runProcess("git", ["diff", "--binary", base, implementationHead], { cwd: workspace });
            await runProcess("git", [...authenticationArgs, "push", "--force-with-lease", "origin", branchName], {
              cwd: workspace,
              timeout: 5 * 60_000,
              secrets: [token, authenticationArgs[1]],
            });
            await db.execution.updateMany({
              where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
              data: { headSha: implementationHead },
            });
            await log(executionId, "preview", "Correção automática aplicada; reconstruindo o ambiente temporário");
            remotePreview = await publishDashboardiaPreview({
              database: db,
              execution,
              projectDirectory,
              runtime: detectedRuntime.runtime,
              log: (scope, message, level, metadata) => log(executionId, scope, message, level, metadata),
            });
            previewOutcome = remotePreview
              ? await waitForPreviewOutcome(remotePreview.id).catch((error) => ({ status: "FAILED", error: error instanceof Error ? error.message : String(error) }))
              : null;
            if (previewOutcome?.status === "READY") {
              await log(executionId, "preview", "Ambiente temporário corrigido e validado com sucesso", "info", {
                previewId: previewOutcome.id,
                url: previewOutcome.url,
              });
            } else {
              await log(executionId, "preview", "O ambiente continuou indisponível após a correção automática; as evidências visuais foram preservadas", "warn", {
                previewId: previewOutcome?.id ?? remotePreview?.id,
                technical: String(previewOutcome?.error || "O host não confirmou a inicialização").slice(-20_000),
              });
            }
          } else if (previewRepairCompleted) {
            await log(executionId, "preview", "O agente não encontrou uma correção aplicável para a falha de inicialização", "warn");
          }
        }
      } else if (remotePreview) {
        await log(executionId, "preview", "O host ainda não confirmou a inicialização; a sincronização continuará pela tela", "warn", {
          previewId: remotePreview.id,
          status: previewOutcome?.status ?? "UNKNOWN",
        });
      }
    }

    await db.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: { id: executionId, cancelRequestedAt: null, stopRequestedAt: null },
        data: {
          status: "WAITING_APPROVAL",
          stage: "PUBLISH",
          summary,
          baseSha: base,
          headSha: implementationHead,
          inputTokens,
          outputTokens,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (updated.count !== 1) throw new ExecutionCancelledError();
      const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage });
      await settleExecutionCredits(transaction, { executionId, consumedCredits: snapshot.simulatedConsumedCredits });
      await transaction.executionArtifact.create({ data: { executionId, type: "diff", name: "changes.diff", content: diffResult.stdout.slice(0, 200_000) } });
      if (visualArtifacts.length) await transaction.executionArtifact.createMany({ data: visualArtifacts.map((artifact) => ({ executionId, ...artifact })) });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "REVIEW" } });
    });
    await log(executionId, "publish", `Branch ${branchName} enviada; aguardando aprovação para abrir Pull Request`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na execução";
    const cancelled = error instanceof ExecutionCancelledError;
    const stopped = error instanceof ExecutionStoppedError;
    const finishedAt = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.execution.update({ where: { id: executionId }, data: { status: stopped ? "STOPPED" : cancelled ? "CANCELLED" : "FAILED", error: stopped || cancelled ? null : message, lockedAt: null, lockedBy: null, finishedAt } });
      if (execution && settings) {
        if (stopped) await settleExecutionCredits(transaction, { executionId, consumedCredits: 0 });
        else {
          const snapshot = await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt });
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
