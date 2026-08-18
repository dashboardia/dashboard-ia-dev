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

const workspaceRoot = path.join(os.tmpdir(), "forgeboard-workspaces");

class ExecutionCancelledError extends Error {
  constructor() {
    super("Execução cancelada pelo Gestor");
    this.name = "ExecutionCancelledError";
  }
}

async function log(executionId, scope, message, level = "info", metadata) {
  await db.executionLog.create({ data: { executionId, scope, message, level, metadata } });
}

async function assertExecutionActive(executionId) {
  const current = await db.execution.findUnique({ where: { id: executionId }, select: { cancelRequestedAt: true } });
  if (current?.cancelRequestedAt) throw new ExecutionCancelledError();
}

function agentPrompt(demand) {
  if (demand.type === "DOCUMENTATION") {
    return [
      "Analise o repositório disponível e produza uma documentação de negócio completa em Markdown.",
      "Não crie, altere ou exclua arquivos. Use somente o shell de leitura para inspecionar a estrutura e os arquivos relevantes.",
      "Escreva para pessoas de produto, negócio e operação; use termos técnicos apenas quando necessários e explique-os.",
      "Inclua: visão geral, problema resolvido, públicos e perfis, funcionalidades, jornadas principais, regras de negócio, dados relevantes, integrações, restrições, riscos ou lacunas e glossário.",
      "Diferencie explicitamente informações confirmadas pelo código de inferências. Não exponha segredos, credenciais ou dados pessoais encontrados no repositório.",
      "Retorne somente a documentação final em Markdown, sem relatar etapas internas da análise.",
      `Projeto: ${demand.project.name}`,
      `Repositório: ${demand.project.repositoryFullName}`,
      `Branch base: ${demand.project.defaultBranch}`,
      `Título solicitado: ${demand.title}`,
      `Objetivo e contexto:\n${demand.description}`,
      demand.acceptanceCriteria ? `Pontos que precisam constar:\n${demand.acceptanceCriteria}` : "Pontos obrigatórios adicionais: não informados",
    ].join("\n\n");
  }

  return [
    "Implemente a demanda aprovada abaixo no repositório disponível.",
    "Antes de editar, inspecione a estrutura e os arquivos relevantes com o shell somente leitura.",
    "Faça alterações pequenas e focadas, preserve a arquitetura e os padrões existentes e não altere arquivos de segredos nem workflows de CI.",
    "Use exclusivamente apply_patch para criar, alterar ou excluir arquivos.",
    "Não execute instalação, build, lint ou testes; o worker fará isso após os patches.",
    "Ao concluir, retorne um resumo objetivo das alterações e dos riscos ou validações pendentes.",
    `Projeto: ${demand.project.name}`,
    `Repositório: ${demand.project.repositoryFullName}`,
    `Branch base: ${demand.project.defaultBranch}`,
    `Tipo: ${demand.type}`,
    `Prioridade: ${demand.priority}`,
    `Título: ${demand.title}`,
    `Descrição:\n${demand.description}`,
    demand.acceptanceCriteria ? `Critérios de aceite:\n${demand.acceptanceCriteria}` : "Critérios de aceite: não informados",
    demand.visualValidation ? `Validação visual obrigatória nas rotas: ${(Array.isArray(demand.visualPaths) ? demand.visualPaths : ["/"]).join(", ")}` : "Validação visual: não solicitada",
  ].join("\n\n");
}

function startImplementationAgent({ projectDirectory, prompt, model }) {
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
        reject(new Error(message.error?.message || "O subprocesso do agente falhou"));
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(forceKillTimer);
      if (!settled) reject(new Error(stderr || `O subprocesso do agente foi encerrado (${signal || code})`));
    });
    child.send({ type: "run", projectDirectory, prompt, model });
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
        select: { cancelRequestedAt: true },
      }).catch(() => null);
      if (current?.cancelRequestedAt && !commandController.signal.aborted) {
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
    const implementationAgent = startImplementationAgent({
      projectDirectory,
      prompt: agentPrompt(execution.demand),
      model: selectedModel,
    });
    const cancellationTimer = setInterval(async () => {
      const current = await db.execution.findUnique({
        where: { id: executionId },
        select: { cancelRequestedAt: true },
      }).catch(() => null);
      if (current?.cancelRequestedAt && !abortReason) {
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
    }, settings.agentTimeoutMinutes * 60_000);
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
      if (abortReason === "cancelled") throw new ExecutionCancelledError();
      if (abortReason === "timeout") {
        throw new Error(`${documentationOnly ? "A documentação" : "A implementação"} excedeu o limite de ${settings.agentTimeoutMinutes} minutos. Revise o escopo da demanda ou tente novamente.`);
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
          where: { id: executionId, cancelRequestedAt: null },
          data: { status: "SUCCEEDED", stage: "ANALYSIS", summary, inputTokens, outputTokens, lockedAt: null, lockedBy: null, finishedAt },
        });
        if (updated.count !== 1) throw new ExecutionCancelledError();
        await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt });
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
        where: { id: executionId, cancelRequestedAt: null },
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
      await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage });
      await transaction.executionArtifact.create({ data: { executionId, type: "diff", name: "changes.diff", content: diffResult.stdout.slice(0, 200_000) } });
      if (visualArtifacts.length) await transaction.executionArtifact.createMany({ data: visualArtifacts.map((artifact) => ({ executionId, ...artifact })) });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "REVIEW" } });
    });
    await log(executionId, "publish", `Branch ${branchName} enviada; aguardando aprovação para abrir Pull Request`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na execução";
    const cancelled = error instanceof ExecutionCancelledError;
    const finishedAt = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.execution.update({ where: { id: executionId }, data: { status: cancelled ? "CANCELLED" : "FAILED", error: cancelled ? null : message, lockedAt: null, lockedBy: null, finishedAt } });
      if (execution && settings) await saveFinancialSnapshot(transaction, { execution, settings, usage: measuredUsage, endedAt: finishedAt });
    }).catch(() => null);
    if (execution?.demandId) await db.demand.update({ where: { id: execution.demandId }, data: { status: cancelled ? "APPROVED" : "FAILED" } }).catch(() => null);
    await log(executionId, "worker", message, cancelled ? "warn" : "error", cancelled ? undefined : {
      code: error?.code ?? null,
      stdout: String(error?.stdout ?? "").slice(-12_000) || "(sem saída padrão)",
      stderr: String(error?.stderr ?? "").slice(-12_000) || message,
    }).catch(() => null);
    if (!cancelled) throw error;
  } finally {
    await cleanWorkspace(workspace).catch(() => null);
    console.log(`[worker:${workerId}] execução ${executionId} finalizada`);
  }
}
