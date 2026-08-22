import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { explainError } from "../../../../../lib/error-messages";
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
    const existingConversationHandlesIt = execution.status === "AWAITING_CLIENT" && Boolean(execution.pullRequest);
    const required = statusAllowsRecovery
      && Boolean(execution.error)
      && !execution.closedAt
      && !expired
      && execution.adjustmentCount < settings.executionConversationMaxAdjustments
      && !isGitHubAuthorizationFailure(execution.error)
      && !existingConversationHandlesIt;

    if (!required) return NextResponse.json({ required: false }, { headers: { "Cache-Control": "no-store" } });
    const explained = explainError(execution.error);
    return NextResponse.json({
      required: true,
      title: explained.title,
      message: explained.message,
      action: explained.action,
      adjustmentCount: execution.adjustmentCount,
      maxAdjustments: settings.executionConversationMaxAdjustments,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
