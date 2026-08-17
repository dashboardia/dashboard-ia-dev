import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Agent, applyPatchTool, run, shellTool } from "@openai/agents";

import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { getProjectGitHubAccessToken } from "../lib/github.js";
import { getGlobalSettings } from "../lib/global-settings.js";
import {
  cleanWorkspace,
  gitAuthenticationArgs,
  ReadOnlyShell,
  resolveWorkspacePath,
  runConfiguredCommand,
  runProcess,
  WorkspaceEditor,
} from "./sandbox.mjs";
import { runVisualValidation } from "./visual-validation.mjs";

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

async function runValidations(execution, projectDirectory, settings) {
  const commands = [
    ["install", execution.demand.project.installCommand],
    ["lint", execution.demand.project.lintCommand],
    ["test", execution.demand.project.testCommand],
    ["build", execution.demand.project.buildCommand],
  ].filter(([, command]) => command?.trim());

  if (!commands.length) {
    await log(execution.id, "validation", "Nenhum comando de validação foi configurado", "warn");
    return;
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
      throw new Error(`Validação ${scope} falhou\n${technical || "O processo terminou sem fornecer detalhes técnicos"}`);
    } finally {
      clearInterval(cancellationTimer);
    }
    await assertExecutionActive(execution.id);
  }
}

export async function processExecution(executionId, workerId) {
  const workspace = path.join(workspaceRoot, executionId);
  let execution;

  try {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada no worker");
    const settings = await getGlobalSettings();
    execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { include: { project: true } } },
    });
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
    await runProcess("git", ["checkout", "-b", branchName], { cwd: workspace });
    const projectDirectory = resolveWorkspacePath(workspace, execution.demand.project.workingDirectory);
    const editor = new WorkspaceEditor(projectDirectory);
    const readOnlyShell = new ReadOnlyShell(projectDirectory);

    await db.execution.update({
      where: { id: executionId },
      data: { status: "RUNNING", stage: "IMPLEMENTATION", branchName, model: env.OPENAI_MODEL ?? "gpt-5.6" },
    });
    await log(executionId, "agent", "Agente de implementação iniciado");

    const agent = new Agent({
      name: "Forgeboard Coding Agent",
      model: env.OPENAI_MODEL ?? "gpt-5.6",
      modelSettings: { reasoning: { effort: "medium", summary: "concise" }, maxTokens: 24_000, store: false },
      instructions: "Você é um engenheiro de software sênior. Trabalhe apenas na demanda aprovada e respeite rigorosamente as ferramentas e os limites do workspace.",
      tools: [
        shellTool({ shell: readOnlyShell, needsApproval: false }),
        applyPatchTool({ editor, needsApproval: false }),
      ],
    });

    let result;
    let abortReason = null;
    const agentController = new AbortController();
    const cancellationTimer = setInterval(async () => {
      const current = await db.execution.findUnique({
        where: { id: executionId },
        select: { cancelRequestedAt: true },
      }).catch(() => null);
      if (current?.cancelRequestedAt && !agentController.signal.aborted) {
        abortReason = "cancelled";
        agentController.abort();
      }
    }, 2_000);
    cancellationTimer.unref();

    const agentTimeout = setTimeout(() => {
      if (!agentController.signal.aborted) {
        abortReason = "timeout";
        agentController.abort();
      }
    }, settings.agentTimeoutMinutes * 60_000);
    agentTimeout.unref();

    try {
      result = await run(agent, agentPrompt(execution.demand), {
        maxTurns: 24,
        signal: agentController.signal,
      });
    } catch (error) {
      if (abortReason === "cancelled") throw new ExecutionCancelledError();
      if (abortReason === "timeout") {
        throw new Error(`A implementação excedeu o limite de ${settings.agentTimeoutMinutes} minutos. Revise o escopo da demanda ou tente novamente.`);
      }
      throw error;
    } finally {
      clearInterval(cancellationTimer);
      clearTimeout(agentTimeout);
    }

    const summary = String(result.finalOutput ?? "Implementação concluída sem resumo.").trim();
    const usage = result.runContext.usage;
    await log(executionId, "agent", "Agente de implementação concluído");
    await assertExecutionActive(executionId);

    const statusResult = await runProcess("git", ["status", "--porcelain"], { cwd: workspace });
    if (!statusResult.stdout.trim()) {
      if (execution.demand.type !== "INVESTIGATION") throw new Error("A IA não produziu alterações no repositório");
      await db.$transaction(async (transaction) => {
        const updated = await transaction.execution.updateMany({
          where: { id: executionId, cancelRequestedAt: null },
          data: { status: "SUCCEEDED", stage: "ANALYSIS", summary, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, lockedAt: null, lockedBy: null, finishedAt: new Date() },
        });
        if (updated.count !== 1) throw new ExecutionCancelledError();
        await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "SUCCEEDED" } });
      });
      return;
    }

    await db.execution.update({ where: { id: executionId }, data: { status: "VALIDATING", stage: "VALIDATION" } });

    // Use sempre a configuração mais recente salva no cadastro do projeto.
    execution.demand.project = await db.project.findUniqueOrThrow({
      where: { id: execution.demand.projectId },
    });
    await runValidations(execution, projectDirectory, settings);
    await assertExecutionActive(executionId);
    let visualArtifacts = [];
    if (execution.demand.visualValidation) {
      await log(executionId, "visual", "Validação visual iniciada");
      visualArtifacts = await runVisualValidation({
        execution,
        projectDirectory,
        log: (scope, message, level, metadata) => log(executionId, scope, message, level, metadata),
      });
      await log(executionId, "visual", `${visualArtifacts.length} evidências visuais geradas`);
      await assertExecutionActive(executionId);
    }
    const diffResult = await runProcess("git", ["diff", "--binary"], { cwd: workspace });

    await runProcess("git", ["add", "-A"], { cwd: workspace });
    await runProcess("git", ["-c", "user.name=Forgeboard", "-c", "user.email=forgeboard@users.noreply.github.com", "commit", "-m", `forgeboard: ${execution.demand.title.slice(0, 120)}`], { cwd: workspace });
    const head = await runProcess("git", ["rev-parse", "HEAD"], { cwd: workspace });
    const base = await runProcess("git", ["rev-parse", execution.demand.project.defaultBranch], { cwd: workspace });
    await runProcess("git", [...authenticationArgs, "push", "-u", "origin", branchName], { cwd: workspace, timeout: 5 * 60_000, secrets: [token, authenticationArgs[1]] });

    await db.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: { id: executionId, cancelRequestedAt: null },
        data: {
          status: "WAITING_APPROVAL",
          stage: "PUBLISH",
          summary,
          baseSha: base.stdout.trim(),
          headSha: head.stdout.trim(),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (updated.count !== 1) throw new ExecutionCancelledError();
      await transaction.executionArtifact.create({ data: { executionId, type: "diff", name: "changes.diff", content: diffResult.stdout.slice(0, 200_000) } });
      if (visualArtifacts.length) await transaction.executionArtifact.createMany({ data: visualArtifacts.map((artifact) => ({ executionId, ...artifact })) });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "REVIEW" } });
    });
    await log(executionId, "publish", `Branch ${branchName} enviada; aguardando aprovação para abrir Pull Request`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na execução";
    const cancelled = error instanceof ExecutionCancelledError;
    await db.execution.update({ where: { id: executionId }, data: { status: cancelled ? "CANCELLED" : "FAILED", error: cancelled ? null : message, lockedAt: null, lockedBy: null, finishedAt: new Date() } }).catch(() => null);
    if (execution?.demandId) await db.demand.update({ where: { id: execution.demandId }, data: { status: cancelled ? "APPROVED" : "FAILED" } }).catch(() => null);
    await log(executionId, "worker", message, cancelled ? "warn" : "error").catch(() => null);
    if (!cancelled) throw error;
  } finally {
    await cleanWorkspace(workspace).catch(() => null);
    console.log(`[worker:${workerId}] execução ${executionId} finalizada`);
  }
}
