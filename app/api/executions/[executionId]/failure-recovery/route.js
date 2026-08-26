import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { getExecutionCreditBudget } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { explainError } from "../../../../../lib/error-messages";
import { isExecutionCreditBlocked } from "../../../../../lib/execution-credit-state";
import { isGitHubAuthorizationFailure } from "../../../../../lib/github-authorization-recovery";
import { getGlobalSettings } from "../../../../../lib/global-settings";
import {
  automaticApplicationRepairCount,
  previewRepairConsentRequired,
  rawPreviewRepairError,
} from "../../../../../lib/preview-repair-consent";
import { redactSensitiveData } from "../../../../../lib/redaction";
import { syncDashboardiaPreview } from "../../../../../lib/preview-host-client";

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        demand: { select: { projectId: true } },
        pullRequest: { select: { id: true } },
        previewEnvironment: true,
        logs: {
          where: { scope: "preview" },
          select: { metadata: true },
        },
      },
    });
    await requireProjectRole(execution.demand.projectId, "MANAGER");
    const previewEnvironment = await syncDashboardiaPreview(db, execution.previewEnvironment, { force: true })
      .catch(() => execution.previewEnvironment);
    const settings = await getGlobalSettings();
    const statusAllowsRecovery = execution.status === "FAILED" || execution.status === "AWAITING_CLIENT";
    const expired = Boolean(execution.conversationExpiresAt && execution.conversationExpiresAt <= new Date());
    const previewConsentRequired = execution.status === "AWAITING_CLIENT"
      && previewEnvironment?.status === "FAILED"
      && previewRepairConsentRequired(previewEnvironment.error)
      && !execution.closedAt
      && !expired;

    if (previewConsentRequired) {
      const creditBudget = await getExecutionCreditBudget(db, {
        executionId,
        marginPercent: settings.creditBalanceSafetyMarginPercent,
      });
      const hasCredits = !creditBudget || creditBudget.hardLimitCredits > 0;
      const technical = redactSensitiveData(rawPreviewRepairError(previewEnvironment.error)).slice(-8_000);
      return NextResponse.json({
        required: true,
        kind: "PREVIEW_REPAIR_CONSENT",
        title: "O ambiente ainda precisa de uma correção",
        message: "A versão navegável ainda não ficou pronta. Você pode enviar o erro completo para a IA revisar o código, as dependências e a configuração de inicialização, mesmo quando a origem da falha não estiver clara.",
        action: hasCredits
          ? "Deseja continuar tentando nesta mesma execução?"
          : "Adicione créditos para continuar esta mesma execução.",
        continuationPrompt: [
          "Analise e tente corrigir a falha do ambiente navegável nesta mesma execução.",
          "Preserve a branch, o Pull Request, o escopo original e todo o trabalho válido já realizado.",
          "Inspecione primeiro os manifests, scripts, dependências, build, porta e caminho real de inicialização do projeto. Não presuma uma stack ou um comando que não exista no código.",
          "Se houver uma correção possível no projeto, aplique-a e deixe a aplicação compatível com o ambiente de preview. Se a evidência apontar exclusivamente para infraestrutura externa, não invente alterações: explique isso objetivamente para o cliente.",
          `Erro mais recente do ambiente:\n${technical}`,
        ].join("\n\n"),
        canContinue: hasCredits,
        blockedReason: !hasCredits ? "CREDITS" : null,
        billingUrl: `/billing?returnTo=${encodeURIComponent(`/executions/${executionId}`)}#credit-packs`,
        automaticRepairCount: automaticApplicationRepairCount(execution.logs),
        adjustmentCount: execution.adjustmentCount,
        maxAdjustments: settings.executionConversationMaxAdjustments,
      }, { headers: { "Cache-Control": "no-store" } });
    }

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
