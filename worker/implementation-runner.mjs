import { Agent, applyPatchTool, run, shellTool } from "@openai/agents";

import { calculateLiveUsageCredits } from "../lib/financial-shadow.js";
import { ReadOnlyShell, WorkspaceEditor } from "./sandbox.mjs";

let controller;
let running = false;

function finish(message, exitCode) {
  if (typeof process.send !== "function") process.exit(exitCode);
  process.send(message, () => process.exit(exitCode));
}

process.on("message", async (message) => {
  if (message?.type === "abort") {
    controller?.abort();
    return;
  }
  if (message?.type !== "run" || running) return;
  running = true;
  controller = new AbortController();

  try {
    const editor = new WorkspaceEditor(message.projectDirectory);
    const readOnlyShell = new ReadOnlyShell(message.projectDirectory);
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
    const result = await run(agent, message.prompt, {
      maxTurns: message.policy?.maxTurns ?? 36,
      signal: controller.signal,
      stream: true,
    });
    let budgetExceeded = false;
    for await (const _event of result) {
      if (!message.creditBudget || !message.creditCostPolicy) continue;
      const consumedCredits = calculateLiveUsageCredits({
        ...message.creditCostPolicy,
        inputTokens: result.runContext.usage.inputTokens,
        outputTokens: result.runContext.usage.outputTokens,
      });
      if (consumedCredits >= message.creditBudget) {
        budgetExceeded = true;
        controller.abort();
        break;
      }
    }
    await result.completed.catch((error) => {
      if (!budgetExceeded) throw error;
    });
    if (budgetExceeded) {
      finish({
        type: "error",
        error: {
          name: "CreditBudgetExceededError",
          code: "CREDIT_BUDGET_EXCEEDED",
          message: `A execução atingiu o limite rígido de ${message.creditBudget} créditos e foi interrompida sem consumir saldo adicional.`,
          inputTokens: result.runContext.usage.inputTokens,
          outputTokens: result.runContext.usage.outputTokens,
        },
      }, 1);
      return;
    }
    finish({
      type: "result",
      result: {
        summary: String(result.finalOutput ?? "Implementação concluída sem resumo.").trim(),
        inputTokens: result.runContext.usage.inputTokens,
        outputTokens: result.runContext.usage.outputTokens,
      },
    }, 0);
  } catch (error) {
    finish({ type: "error", error: { name: error?.name, message: error instanceof Error ? error.message : String(error) } }, 1);
  }
});
