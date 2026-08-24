import { Agent, applyPatchTool, run, shellTool } from "@openai/agents";
import OpenAI from "openai";

import { attachmentInputItem } from "../lib/attachment-input.js";
import { calculateLiveUsageCredits } from "../lib/financial-shadow.js";
import { RepositoryReadShell } from "./repository-read-shell.mjs";
import { WorkspaceEditor } from "./sandbox.mjs";
import { continuationPrompt, isAgentTurnLimitError, maxTurnSegmentsForPolicy } from "./agent-turn-continuation.mjs";
import { prepareWorkspaceAttachments, workspaceAttachmentInstructions } from "./workspace-attachments.mjs";

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

function responseUsageOf(response) {
  return {
    inputTokens: Math.max(0, Number(response?.usage?.input_tokens) || 0),
    outputTokens: Math.max(0, Number(response?.usage?.output_tokens) || 0),
  };
}

function inputFor(attachments, prompt) {
  return attachments.length
    ? [{ role: "user", content: [{ type: "input_text", text: prompt }, ...attachments] }]
    : prompt;
}

async function groundImageAttachments(attachments, model, signal) {
  const imageAttachments = attachments.filter((attachment) => attachment?.type === "input_image");
  const passthroughAttachments = attachments.filter((attachment) => attachment?.type !== "input_image");

  if (!imageAttachments.length) {
    return {
      attachments: passthroughAttachments,
      visualContext: "",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const imageContent = imageAttachments.map((attachment, index) => {
    if (typeof attachment.image !== "string" || !attachment.image.startsWith("data:image/")) {
      const error = new Error(`O anexo de imagem ${index + 1} não pôde ser preparado para leitura visual.`);
      error.code = "INVALID_IMAGE_ATTACHMENT";
      throw error;
    }
    return {
      type: "input_image",
      image_url: attachment.image,
      detail: attachment.detail ?? "auto",
    };
  });

  const client = new OpenAI();
  const response = await client.responses.create({
    model,
    store: false,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "Analise cuidadosamente os prints anexados pelo cliente no contexto de uma solicitação de alteração de software.",
            "Descreva somente fatos visuais úteis para o engenheiro que fará a correção: textos visíveis, mensagens de erro, estados, componentes, layout, comportamento aparente e inconsistências relevantes.",
            "Quando houver mais de uma imagem, diferencie-as por ordem. Não invente elementos não visíveis e não proponha a implementação ainda.",
          ].join(" "),
        },
        ...imageContent,
      ],
    }],
  }, { signal });

  return {
    attachments: passthroughAttachments,
    visualContext: String(response.output_text || "").trim(),
    usage: responseUsageOf(response),
  };
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
  let preparedWorkspaceAttachments = null;

  try {
    const rawAttachments = Array.isArray(message.attachments) ? message.attachments : [];
    preparedWorkspaceAttachments = await prepareWorkspaceAttachments(rawAttachments);
    const agentAttachments = rawAttachments.map((attachment) => attachmentInputItem({
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: Buffer.from(attachment.dataBase64, "base64"),
    }));
    const editor = new WorkspaceEditor(message.projectDirectory);
    const readOnlyShell = new RepositoryReadShell(message.projectDirectory, {
      attachments: preparedWorkspaceAttachments.items,
    });
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

    const groundedInput = await groundImageAttachments(
      agentAttachments,
      message.model,
      controller.signal,
    );
    totalInputTokens += groundedInput.usage.inputTokens;
    totalOutputTokens += groundedInput.usage.outputTokens;

    if (message.creditBudget != null && message.creditCostPolicy) {
      const groundingCredits = calculateLiveUsageCredits({
        ...message.creditCostPolicy,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      });
      if (groundingCredits > message.creditBudget) {
        const budgetError = new Error(`A leitura dos anexos ultrapassou o limite de ${message.creditBudget} créditos disponível para esta execução.`);
        budgetError.name = "CreditBudgetExceededError";
        budgetError.code = "CREDIT_BUDGET_EXCEEDED";
        budgetError.inputTokens = totalInputTokens;
        budgetError.outputTokens = totalOutputTokens;
        throw budgetError;
      }
    }

    const visualContext = groundedInput.visualContext
      ? `\n\n## Leitura visual dos anexos do cliente\n${groundedInput.visualContext}\n\nUse esta leitura como evidência da solicitação do cliente. Confirme no código o que precisa ser alterado antes de editar.`
      : "";
    const attachmentContext = workspaceAttachmentInstructions(preparedWorkspaceAttachments.items);

    const maxSegments = maxTurnSegmentsForPolicy(message.policy);
    for (let segment = 1; segment <= maxSegments; segment += 1) {
      const basePrompt = segment === 1
        ? message.prompt
        : continuationPrompt(message.prompt, segment, maxSegments);
      const prompt = `${basePrompt}${visualContext}${attachmentContext ? `\n\n${attachmentContext}` : ""}`;
      let result;
      let budgetExceeded = false;
      let usageRecorded = false;

      try {
        result = await run(agent, inputFor(groundedInput.attachments, prompt), {
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
          await preparedWorkspaceAttachments.cleanup().catch(() => null);
          preparedWorkspaceAttachments = null;
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

        await preparedWorkspaceAttachments.cleanup().catch(() => null);
        preparedWorkspaceAttachments = null;
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
    await preparedWorkspaceAttachments?.cleanup().catch(() => null);
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
