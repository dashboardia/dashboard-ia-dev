import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import { updateAsaasSubscriptionPlan } from "../../../../lib/asaas";
import { activatePlanUpgrade, BillingAccessError, ensureBillingAccount } from "../../../../lib/billing";
import { findBillingPlan, getBillingPlan, planChangeKind, planIsPaid } from "../../../../lib/billing-plans";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { billingChangePlanSchema } from "../../../../lib/validation";

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = billingChangePlanSchema.parse(await request.json());
    const account = await ensureBillingAccount(user);
    const currentPlan = await getBillingPlan(account.plan);
    if (account.status !== "ACTIVE" || !planIsPaid(currentPlan)) {
      throw new BillingAccessError("É necessário ter uma assinatura paga ativa para trocar de plano.", 409);
    }
    if (account.plan === input.plan) throw new BillingAccessError("Este já é o plano atual.", 409);
    const plan = await findBillingPlan(input.plan);
    if (!planIsPaid(plan) || !plan.active || !plan.public) throw new BillingAccessError("Este plano não está disponível para contratação.", 404, "PLAN_UNAVAILABLE");
    const changeKind = planChangeKind(currentPlan, plan);
    if (changeKind === "DOWNGRADE") {
      throw new BillingAccessError("O downgrade ficará disponível somente após o término do ciclo atual.", 409, "DOWNGRADE_LOCKED_UNTIL_CYCLE_END");
    }
    let providerIdentity;
    try {
      const originalCheckouts = !account.providerSubscriptionId
        ? await db.billingCheckout.findMany({
          where: { accountId: account.id, kind: "PLAN" },
          select: { id: true, providerCheckoutId: true },
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
          take: 5,
        })
        : [];
      providerIdentity = await updateAsaasSubscriptionPlan({
        subscriptionId: account.providerSubscriptionId,
        customerId: account.providerCustomerId,
        customerEmail: user.email,
        checkouts: originalCheckouts,
        plan,
      });
    } catch (providerError) {
      throw new BillingAccessError(`Não foi possível alterar a assinatura no Asaas: ${providerError instanceof Error ? providerError.message : "erro não identificado"}`, 409, "PROVIDER_PLAN_CHANGE_FAILED");
    }
    await db.$transaction(async (transaction) => {
      await activatePlanUpgrade(transaction, {
        account,
        planCode: input.plan,
        sourceRef: `${account.id}:${account.cycleStartedAt?.toISOString() || "current"}:${input.plan}`,
        providerCustomerId: providerIdentity.customerId,
        providerSubscriptionId: providerIdentity.subscriptionId,
      });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.subscription.upgrade", entityType: "BillingAccount", entityId: account.id, metadata: { from: account.plan, to: input.plan, creditsAdded: plan.includedCredits }, request }) });
    });
    return NextResponse.json({ immediate: true, plan: input.plan, creditsAdded: plan.includedCredits });
  } catch (error) {
    return apiError(error);
  }
}
