import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { validateAttachmentFiles } from "../../../../../lib/attachments";
import { BillingAccessError, getExecutionCreditBudget } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { executionControlState } from "../../../../../lib/execution-control-state";
import { clientInteractionRequeueData } from "../../../../../lib/executions";
import { getGlobalSettings } from "../../../../../lib/global-settings";
import { redactSensitiveData } from "../../../../../lib/redaction";
import { executionMessageInputSchema } from "../../../../../lib/validation";
import { deletePrivateObject, putPrivateObject } from "../../../../../lib/visual-storage";

const MINIMUM_CONVERSATION_TIMEOUT_MINUTES = 24 * 60;

function recoveryDemandDescription(execution, content) {
  if (!execution.error || execution.pullRequest) return null;
  const original = String(execution.demand.description ?? "").slice(0, 12_000);
  const technical = redactSensitiveData(execution.error).slice(-6_000);
  const request = String(content ?? "").slice(0, 8_000);
  return [
    original,
    "## Continuação após falha da execução",
    `Falha anterior:\n${technical}`,
    `Ajuste solicitado pelo cliente:\n${request}`,
    "Continue a demanda original preservando tudo que já estiver correto e trate a falha acima antes de concluir.",
  ].filter(Boolean).join("\n\n");
}

export async function POST(request, context) {
  const uploadedKeys = [];
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const formData = await request.formData();
    const preparedAttachments = validateAttachmentFiles(formData.getAll("attachments"));
    const fallbackContent = preparedAttachments.length ? "Considere os arquivos anexados neste ajuste." : "";
    const input = executionMessageInputSchema.parse({ content: String(formData.get("content") ?? "").trim() || fallbackContent });
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: true, pullRequest: true, previewEnvironment: true },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    const settings = await getGlobalSettings();
    const control = executionControlState(execution);
    if (!control.interactionAvailable || execution.closedAt) {
      const error = control.awaitingEnvironment
        ? "Aguarde o ambiente ficar pronto ou pause os processos antes de enviar um novo ajuste."
        : "Esta execução não está disponível para novos ajustes";
      return NextResponse.json({ error }, { status: 409 });
    }
    if (execution.conversationExpiresAt && execution.conversationExpiresAt <= new Date()) {
      return NextResponse.json({ error: "A sessão expirou após 24 horas sem interação. A execução será encerrada por inatividade." }, { status: 409 });
    }
    const creditBudget = await getExecutionCreditBudget(db, { executionId, marginPercent: settings.creditBalanceSafetyMarginPercent });
    if (creditBudget && creditBudget.hardLimitCredits < 1) {
      throw new BillingAccessError("Não há saldo disponível para processar este ajuste. Adicione créditos e tente novamente.", 402, "INSUFFICIENT_CREDITS");
    }

    const storedAttachments = [];
    for (const attachment of preparedAttachments) {
      const storageKey = `execution-messages/${executionId}/${randomUUID()}/${attachment.name}`;
      const data = Buffer.from(await attachment.file.arrayBuffer());
      await putPrivateObject(storageKey, data, attachment.mimeType);
      uploadedKeys.push(storageKey);
      storedAttachments.push({ name: attachment.name, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, storageKey });
    }

    const continuationDescription = recoveryDemandDescription(execution, input.content);
    const result = await db.$transaction(async (transaction) => {
      const interactionAt = new Date();
      const message = await transaction.executionMessage.create({
        data: {
          executionId,
          authorId: user.id,
          role: "USER",
          content: input.content,
          attachments: { create: storedAttachments },
        },
        include: { attachments: true },
      });
      const updated = await transaction.execution.updateMany({
        where: { id: executionId, status: { in: ["AWAITING_CLIENT", "FAILED", "STOPPED"] }, closedAt: null },
        data: {
          ...clientInteractionRequeueData({
            now: interactionAt,
            timeoutMinutes: Math.max(MINIMUM_CONVERSATION_TIMEOUT_MINUTES, settings.executionConversationTimeoutMinutes),
          }),
          stopRequestedAt: null,
        },
      });
      if (updated.count !== 1) throw new Error("A execução mudou de estado enquanto o ajuste era enviado");
      await transaction.demand.update({
        where: { id: execution.demandId },
        data: { status: "QUEUED", ...(continuationDescription ? { description: continuationDescription } : {}) },
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.adjustment.request",
          entityType: "Execution",
          entityId: executionId,
          metadata: {
            adjustment: execution.adjustmentCount + 1,
            billing: "measured_usage",
            attachments: storedAttachments.length,
            failureRecovery: Boolean(execution.error),
            resumedFromPause: execution.status === "STOPPED",
          },
          request,
        }),
      });
      return message;
    });
    uploadedKeys.length = 0;
    return NextResponse.json({ message: result }, { status: 202 });
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map((key) => deletePrivateObject(key)));
    return apiError(error);
  }
}
