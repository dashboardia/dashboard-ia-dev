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
    let providerSubscriptionId;
    try {
      providerSubscriptionId = await updateAsaasSubscriptionPlan({
        subscriptionId: account.providerSubscriptionId,
        customerId: account.providerCustomerId,
        plan,
      });
    } catch (providerError) {
      throw new BillingAccessError(`Não foi possível alterar a assinatura no Asaas: ${providerError instanceof Error ? providerError.message : "erro não identificado"}`, 409, "PROVIDER_PLAN_CHANGE_FAILED");
    }
    if (changeKind === "UPGRADE") {
      await db.$transaction(async (transaction) => {
        await activatePlanUpgrade(transaction, {
          account,
          planCode: input.plan,
          sourceRef: `${account.id}:${account.cycleStartedAt?.toISOString() || "current"}:${input.plan}`,
          providerSubscriptionId,
        });
        await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.subscription.upgrade", entityType: "BillingAccount", entityId: account.id, metadata: { from: account.plan, to: input.plan, creditsAdded: plan.includedCredits }, request }) });
      });
      return NextResponse.json({ immediate: true, plan: input.plan, creditsAdded: plan.includedCredits });
    }
    await db.$transaction([
      db.billingAccount.update({ where: { id: account.id }, data: { pendingPlan: input.plan, providerSubscriptionId } }),
      db.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.subscription.downgrade", entityType: "BillingAccount", entityId: account.id, metadata: { from: account.plan, to: input.plan }, request }) }),
    ]);
    return NextResponse.json({ scheduled: true, plan: input.plan, effectiveAt: account.cycleEndsAt });
  } catch (error) {
    return apiError(error);
  }
}
