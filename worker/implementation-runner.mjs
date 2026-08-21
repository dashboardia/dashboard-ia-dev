import { Agent, applyPatchTool, run, shellTool } from "@openai/agents";

import { calculateLiveUsageCredits } from "../lib/financial-shadow.js";
import { RepositoryReadShell } from "./repository-read-shell.mjs";
import { WorkspaceEditor } from "./sandbox.mjs";
import { continuationPrompt, isAgentTurnLimitError, maxTurnSegmentsForPolicy } from "./agent-turn-continuation.mjs";

let controller;
let running = false;

function finish(message, exitCode) {
  if (typeof process.send !== "function") process.exit(exitCode);
  process.send(message, () => process.exit(exitCode));
}

function usageOf(result) {
  return {
    inputTokens: Math.max(0, Number(result?.runContext?.usage?.inputTokens) || 0),
    outputTokens: Math.max(0, Number(result?.runContext?.usage?.outputTokens) || 0),
  };
}

function inputFor(message, prompt) {
  return message.attachments?.length
    ? [{ role: "user", content: [{ type: "input_text", text: prompt }, ...message.attachments] }]
    : prompt;
}

process.on("message", async (message) => {
  if (message?.type === "abort") {
    controller?.abort();
    return;
  }
  if (message?.type !== "run" || running) return;
  running = true;
  controller = new AbortController();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    const editor = new WorkspaceEditor(message.projectDirectory);
    const readOnlyShell = new RepositoryReadShell(message.projectDirectory);
    const agent = new Agent({
      name: "Forgeboard Coding Agent",
      model: message.model,
      modelSettings: {
        reasoning: { effort: message.policy?.reasoningEffort ?? "medium", summary: "concise" },
        maxTokens: message.policy?.maxTokens ?? 24_000,
        store: false,
      },
      instructions: "Você é um engenheiro de software sênior. Trabalhe apenas na demanda aprovada e respeite rigorosamente as ferramentas e os limites do workspace.",
      tools: [
        shellTool({ shell: readOnlyShell, needsApproval: false }),
        applyPatchTool({ editor, needsApproval: false }),
      ],
    });

    const maxSegments = maxTurnSegmentsForPolicy(message.policy);
    for (let segment = 1; segment <= maxSegments; segment += 1) {
      const prompt = segment === 1
        ? message.prompt
        : continuationPrompt(message.prompt, segment, maxSegments);
      let result;
      let budgetExceeded = false;
      let usageRecorded = false;

      try {
        result = await run(agent, inputFor(message, prompt), {
          maxTurns: message.policy?.maxTurns ?? 36,
          signal: controller.signal,
          stream: true,
        });

        for await (const _event of result) {
          if (message.creditBudget == null || !message.creditCostPolicy) continue;
          const currentUsage = usageOf(result);
          const consumedCredits = calculateLiveUsageCredits({
            ...message.creditCostPolicy,
            inputTokens: totalInputTokens + currentUsage.inputTokens,
            outputTokens: totalOutputTokens + currentUsage.outputTokens,
          });
          if (consumedCredits > message.creditBudget) {
            budgetExceeded = true;
            controller.abort();
            break;
          }
        }

        await result.completed.catch((error) => {
          if (!budgetExceeded) throw error;
        });

        const currentUsage = usageOf(result);
        totalInputTokens += currentUsage.inputTokens;
        totalOutputTokens += currentUsage.outputTokens;
        usageRecorded = true;

        if (budgetExceeded) {
          finish({
            type: "error",
            error: {
              name: "CreditBudgetExceededError",
              code: "CREDIT_BUDGET_EXCEEDED",
              message: `A execução ultrapassou o limite de ${message.creditBudget} créditos, calculado sobre ${message.creditBudgetContext?.availableCredits ?? "o saldo disponível"} créditos disponíveis com margem de continuidade de ${message.creditBudgetContext?.marginPercent ?? 0}%.`,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          }, 1);
          return;
        }

        finish({
          type: "result",
          result: {
            summary: String(result.finalOutput ?? "Implementação concluída sem resumo.").trim(),
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        }, 0);
        return;
      } catch (error) {
        if (result && !usageRecorded) {
          const currentUsage = usageOf(result);
          totalInputTokens += currentUsage.inputTokens;
          totalOutputTokens += currentUsage.outputTokens;
        }

        if (isAgentTurnLimitError(error) && segment < maxSegments && !controller.signal.aborted) {
          continue;
        }

        if (isAgentTurnLimitError(error)) {
          const continuationError = new Error("A execução ficou maior do que o limite interno de continuidade automática. O trabalho já realizado foi preservado, mas ainda restaram etapas pendentes.");
          continuationError.name = "AgentContinuationLimitError";
          continuationError.code = "AGENT_CONTINUATION_LIMIT_EXCEEDED";
          continuationError.inputTokens = totalInputTokens;
          continuationError.outputTokens = totalOutputTokens;
          throw continuationError;
        }

        if (totalInputTokens || totalOutputTokens) {
          error.inputTokens = totalInputTokens;
          error.outputTokens = totalOutputTokens;
        }
        throw error;
      }
    }
  } catch (error) {
    finish({
      type: "error",
      error: {
        name: error?.name,
        code: error?.code,
        message: error instanceof Error ? error.message : String(error),
        inputTokens: error?.inputTokens ?? totalInputTokens,
        outputTokens: error?.outputTokens ?? totalOutputTokens,
      },
    }, 1);
  }
});
