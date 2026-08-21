import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { validateAttachmentFiles } from "../../../../../lib/attachments";
import { BillingAccessError, getExecutionCreditBudget } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { clientInteractionRequeueData } from "../../../../../lib/executions";
import { getGlobalSettings } from "../../../../../lib/global-settings";
import { executionMessageInputSchema } from "../../../../../lib/validation";
import { deletePrivateObject, putPrivateObject } from "../../../../../lib/visual-storage";

const MINIMUM_CONVERSATION_TIMEOUT_MINUTES = 24 * 60;

export async function POST(request, context) {
  const uploadedKeys = [];
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const formData = await request.formData();
    const preparedAttachments = validateAttachmentFiles(formData.getAll("attachments"));
    const fallbackContent = preparedAttachments.length ? "Considere os arquivos anexados neste ajuste." : "";
    const input = executionMessageInputSchema.parse({ content: String(formData.get("content") ?? "").trim() || fallbackContent });
    const execution = await db.execution.findUniqueOrThrow({ where: { id: executionId }, include: { demand: true, pullRequest: true } });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    const settings = await getGlobalSettings();
    if (!execution.pullRequest || execution.status !== "AWAITING_CLIENT" || execution.closedAt) {
      return NextResponse.json({ error: "Esta execução não está disponível para novos ajustes" }, { status: 409 });
    }
    if (execution.conversationExpiresAt && execution.conversationExpiresAt <= new Date()) {
      return NextResponse.json({ error: "A sessão expirou após 24 horas sem interação. Crie uma nova demanda para continuar." }, { status: 409 });
    }
    if (execution.adjustmentCount >= settings.executionConversationMaxAdjustments) {
      return NextResponse.json({ error: "O limite de ajustes desta execução foi atingido. Conclua a execução e abra uma nova demanda." }, { status: 409 });
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
        where: { id: executionId, status: "AWAITING_CLIENT", closedAt: null },
        data: clientInteractionRequeueData({
          now: interactionAt,
          timeoutMinutes: Math.max(MINIMUM_CONVERSATION_TIMEOUT_MINUTES, settings.executionConversationTimeoutMinutes),
        }),
      });
      if (updated.count !== 1) throw new Error("A execução mudou de estado enquanto o ajuste era enviado");
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "QUEUED" } });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.adjustment.request",
          entityType: "Execution",
          entityId: executionId,
          metadata: { adjustment: execution.adjustmentCount + 1, billing: "measured_usage", attachments: storedAttachments.length },
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
