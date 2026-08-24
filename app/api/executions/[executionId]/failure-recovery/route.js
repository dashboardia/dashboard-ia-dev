import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { getExecutionCreditBudget } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { explainError } from "../../../../../lib/error-messages";
import { isExecutionCreditBlocked } from "../../../../../lib/execution-credit-state";
import { isGitHubAuthorizationFailure } from "../../../../../lib/github-authorization-recovery";
import { getGlobalSettings } from "../../../../../lib/global-settings";

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { demand: { select: { projectId: true } }, pullRequest: { select: { id: true } } },
    });
    await requireProjectRole(execution.demand.projectId, "MANAGER");
    const settings = await getGlobalSettings();
    const statusAllowsRecovery = execution.status === "FAILED" || execution.status === "AWAITING_CLIENT";
    const expired = Boolean(execution.conversationExpiresAt && execution.conversationExpiresAt <= new Date());
    const creditBlocked = isExecutionCreditBlocked(execution.error);
    const existingConversationHandlesIt = !creditBlocked && execution.status === "AWAITING_CLIENT" && Boolean(execution.pullRequest);
    const required = statusAllowsRecovery
      && Boolean(execution.error)
      && !execution.closedAt
      && !expired
      && (creditBlocked || execution.adjustmentCount < settings.executionConversationMaxAdjustments)
      && !isGitHubAuthorizationFailure(execution.error)
      && !existingConversationHandlesIt;

    if (!required) return NextResponse.json({ required: false }, { headers: { "Cache-Control": "no-store" } });
    const explained = explainError(execution.error);
    const creditBudget = creditBlocked ? await getExecutionCreditBudget(db, {
      executionId,
      marginPercent: settings.creditBalanceSafetyMarginPercent,
    }) : null;
    return NextResponse.json({
      required: true,
      kind: creditBlocked ? "CREDITS" : "FAILURE",
      title: explained.title,
      message: explained.message,
      action: explained.action,
      billingUrl: `/billing?returnTo=${encodeURIComponent(`/executions/${executionId}`)}#credit-packs`,
      canResume: creditBlocked && (creditBudget?.hardLimitCredits ?? 0) > 0,
      adjustmentCount: execution.adjustmentCount,
      maxAdjustments: settings.executionConversationMaxAdjustments,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
