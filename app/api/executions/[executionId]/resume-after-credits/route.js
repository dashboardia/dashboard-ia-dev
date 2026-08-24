import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { BillingAccessError, getExecutionCreditBudget } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { isExecutionCreditBlocked } from "../../../../../lib/execution-credit-state";
import { requeueFailedExecutionData } from "../../../../../lib/executions";
import { getGlobalSettings } from "../../../../../lib/global-settings";
import { assertOperationalAccess } from "../../../../../lib/operational-access";
import { assertPlatformProcessingEnabled } from "../../../../../lib/platform-processing";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { select: { id: true, projectId: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    await assertOperationalAccess(user);
    await assertPlatformProcessingEnabled(db);

    if (!["FAILED", "AWAITING_CLIENT"].includes(execution.status) || !isExecutionCreditBlocked(execution.error) || execution.closedAt) {
      return NextResponse.json({ error: "Esta execução não está aguardando uma recarga de créditos." }, { status: 409 });
    }

    const settings = await getGlobalSettings();
    const budget = await getExecutionCreditBudget(db, {
      executionId,
      marginPercent: settings.creditBalanceSafetyMarginPercent,
    });
    if (!budget || budget.hardLimitCredits < 1) {
      throw new BillingAccessError("Seus créditos ainda não são suficientes para continuar. Adicione créditos e tente novamente.", 402, "INSUFFICIENT_CREDITS");
    }

    const now = new Date();
    await db.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: { id: executionId, status: { in: ["FAILED", "AWAITING_CLIENT"] }, closedAt: null },
        data: requeueFailedExecutionData({ now, timeoutMinutes: settings.executionConversationTimeoutMinutes }),
      });
      if (updated.count !== 1) throw new Error("A execução mudou de estado enquanto era retomada");
      await transaction.demand.update({ where: { id: execution.demand.id }, data: { status: "QUEUED" } });
      await transaction.executionMessage.create({
        data: { executionId, role: "SYSTEM", content: "Créditos disponíveis novamente. A execução foi retomada automaticamente do ponto em que parou." },
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: user.id,
          projectId: execution.demand.projectId,
          action: "execution.resume_after_credits",
          entityType: "Execution",
          entityId: executionId,
          metadata: { availableCredits: budget.availableCredits, hardLimitCredits: budget.hardLimitCredits },
          request,
        }),
      });
    });

    return NextResponse.json({ resumed: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
