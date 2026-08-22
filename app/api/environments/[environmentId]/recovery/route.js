import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { buildEnvironmentRecoveryDraft } from "../../../../../lib/environment-recovery";
import { getGlobalSettings } from "../../../../../lib/global-settings";

export async function GET(_request, context) {
  try {
    const { environmentId } = await context.params;
    const environment = await db.devEnvironment.findUniqueOrThrow({ where: { id: environmentId } });
    await requireProjectRole(environment.projectId, "MANAGER");
    if (environment.status !== "FAILED" || !environment.error) {
      return NextResponse.json({ error: "Este ambiente não possui uma falha disponível para correção." }, { status: 409 });
    }

    const settings = await getGlobalSettings();
    const candidates = await db.execution.findMany({
      where: {
        branchName: environment.branchName,
        status: "AWAITING_CLIENT",
        closedAt: null,
        demand: { projectId: environment.projectId },
      },
      select: {
        id: true,
        adjustmentCount: true,
        conversationExpiresAt: true,
        pullRequest: { select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    const now = new Date();
    const openExecution = candidates.find((execution) => execution.pullRequest
      && execution.adjustmentCount < settings.executionConversationMaxAdjustments
      && (!execution.conversationExpiresAt || execution.conversationExpiresAt > now));
    const draft = buildEnvironmentRecoveryDraft(environment);

    if (openExecution) {
      return NextResponse.json({
        target: "INTERACTION",
        executionId: openExecution.id,
        href: `/executions/${openExecution.id}#execution-adjustment`,
        draft: { ...draft, target: "INTERACTION", executionId: openExecution.id },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({
      target: "DEMAND",
      href: `/demands/new?projectId=${encodeURIComponent(environment.projectId)}`,
      draft: { ...draft, target: "DEMAND", executionId: null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
