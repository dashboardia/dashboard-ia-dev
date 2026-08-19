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
import { runVisualValidation } from "./visual-validation.mjs";
import { DEFAULT_AI_MODEL } from "../lib/ai-models.js";
import { saveFinancialSnapshot } from "../lib/financial-shadow.js";
import { settleExecutionCredits } from "../lib/billing.js";
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

async function log(executionId, scope, message, level = "info", metadata) {
  await db.executionLog.create({ data: { executionId, scope, message, level, metadata } });
}

async function assertExecutionActive(executionId) {
  const current = await db.execution.findUnique({ where: { id: executionId }, select: { cancelRequestedAt: true, stopRequestedAt: true } });
  if (current?.stopRequestedAt) throw new ExecutionStoppedError();
  if (current?.cancelRequestedAt) throw new ExecutionCancelledError();
}

function startImplementationAgent({ projectDirectory, prompt, model, policy, creditBudget, creditCostPolicy }) {
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
    child.send({ type: "run", projectDirectory, prompt, model, policy, creditBudget, creditCostPolicy });
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
    const reservation = await db.executionCreditReservation.findUnique({
      where: { executionId },
      select: { reservedCredits: true },
    });
    const creditBudget = reservation?.reservedCredits ?? null;
    await log(executionId, "agent", `Escopo ${agentPolicy.scope === "COMPLEX" ? "amplo" : "padrão"} detectado`, "info", {
      maxTurns: agentPolicy.maxTurns,
      timeoutMinutes: agentPolicy.timeoutMinutes,
    });
    const implementationAgent = startImplementationAgent({
      projectDirectory,
      prompt: buildAgentPrompt(execution.demand, agentPolicy.scope),
      model: selectedModel,
      policy: agentPolicy,
      creditBudget,
      creditCostPolicy: creditBudget ? {
        model: selectedModel,
        usdToBrlCents: settings.usdToBrlCents,
        aiSafetyPercent: settings.aiSafetyPercent,
        creditValueCents: settings.creditValueCents,
        targetGrossMarginPercent: settings.targetGrossMarginPercent,
      } : null,
    });
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
      const result = await implementationAgent.promise;
      summary = result.summary;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      measuredUsage = { inputTokens, outputTokens };
    } catch (error) {
      if (error?.inputTokens != null && error?.outputTokens != null) {
        measuredUsage = { inputTokens: error.inputTokens, outputTokens: error.outputTokens };
      }
      if (abortReason === "stopped") throw new ExecutionStoppedError();
      if (abortReason === "cancelled") throw new ExecutionCancelledError();
      if (abortReason === "timeout") {
        throw new Error(`${documentationOnly ? "A documentação" : "A implementação"} excedeu o limite de ${agentPolicy.timeoutMinutes} minutos. Revise o escopo da demanda ou tente novamente.`);
      }
      throw error;
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
    const implementationHead = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
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
    let visualArtifacts = [];
    if (execution.demand.visualValidation) {
      // O build aquece as transformações e o cache de arquivos usados pelo Vite.
      // Mesmo quando falha, o processo é encerrado antes de iniciar o Chromium.
      await runValidations(execution, projectDirectory, settings);
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
      await runValidations(execution, projectDirectory, settings);
      await assertExecutionActive(executionId);
    }
    await cleanValidationArtifacts(projectDirectory);
    await restoreImplementationSnapshot(workspace, implementationHead);
    const diffResult = await runProcess("git", ["diff", "--binary", base, implementationHead], { cwd: workspace });
    await runProcess("git", [...authenticationArgs, "push", "-u", "origin", branchName], { cwd: workspace, timeout: 5 * 60_000, secrets: [token, authenticationArgs[1]] });

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
