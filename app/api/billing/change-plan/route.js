import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import { updateAsaasSubscriptionPlan } from "../../../../lib/asaas";
import { BillingAccessError, ensureBillingAccount } from "../../../../lib/billing";
import { getBillingPlan } from "../../../../lib/billing-plans";
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
    if (account.status !== "ACTIVE" || !["STUDIO", "AGENCY"].includes(account.plan)) {
      throw new BillingAccessError("É necessário ter uma assinatura paga ativa para trocar de plano.", 409);
    }
    if (account.plan === input.plan) throw new BillingAccessError("Este já é o plano atual.", 409);
    const plan = getBillingPlan(input.plan);
    await updateAsaasSubscriptionPlan(account.providerSubscriptionId, plan);
    await db.$transaction([
      db.billingAccount.update({ where: { id: account.id }, data: { pendingPlan: input.plan } }),
      db.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.subscription.change_plan", entityType: "BillingAccount", entityId: account.id, metadata: { from: account.plan, to: input.plan }, request }) }),
    ]);
    return NextResponse.json({ scheduled: true, plan: input.plan, effectiveAt: account.cycleEndsAt });
  } catch (error) {
    return apiError(error);
  }
}
