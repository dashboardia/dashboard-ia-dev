import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { BillingAccessError, getExecutionCreditBudget } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { getGlobalSettings } from "../../../../../lib/global-settings";
import { executionMessageInputSchema } from "../../../../../lib/validation";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const input = executionMessageInputSchema.parse(await request.json());
    const execution = await db.execution.findUniqueOrThrow({ where: { id: executionId }, include: { demand: true, pullRequest: true } });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    const settings = await getGlobalSettings();
    if (!execution.pullRequest || execution.status !== "AWAITING_CLIENT" || execution.closedAt) {
      return NextResponse.json({ error: "Esta execução não está disponível para novos ajustes" }, { status: 409 });
    }
    if (execution.conversationExpiresAt && execution.conversationExpiresAt <= new Date()) {
      return NextResponse.json({ error: "A sessão expirou por inatividade. Crie uma nova demanda para continuar." }, { status: 409 });
    }
    if (execution.adjustmentCount >= settings.executionConversationMaxAdjustments) {
      return NextResponse.json({ error: "O limite de ajustes desta execução foi atingido. Conclua a execução e abra uma nova demanda." }, { status: 409 });
    }
    const creditBudget = await getExecutionCreditBudget(db, {
      executionId,
      marginPercent: settings.creditBalanceSafetyMarginPercent,
    });
    if (creditBudget && creditBudget.hardLimitCredits < 1) {
      throw new BillingAccessError("Não há saldo disponível para processar este ajuste. Adicione créditos e tente novamente.", 402, "INSUFFICIENT_CREDITS");
    }

    const result = await db.$transaction(async (transaction) => {
      const message = await transaction.executionMessage.create({ data: { executionId, authorId: user.id, role: "USER", content: input.content } });
      const updated = await transaction.execution.updateMany({
        where: { id: executionId, status: "AWAITING_CLIENT", closedAt: null },
        data: {
          status: "QUEUED",
          stage: "IMPLEMENTATION",
          adjustmentCount: { increment: 1 },
          lastInteractionAt: new Date(),
          conversationExpiresAt: new Date(Date.now() + settings.executionConversationTimeoutMinutes * 60_000),
          finishedAt: null,
          error: null,
        },
      });
      if (updated.count !== 1) throw new Error("A execução mudou de estado enquanto o ajuste era enviado");
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, projectId: execution.demand.projectId, action: "execution.adjustment.request", entityType: "Execution", entityId: executionId, metadata: { adjustment: execution.adjustmentCount + 1, billing: "measured_usage" }, request }) });
      return message;
    });
    return NextResponse.json({ message: result }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
