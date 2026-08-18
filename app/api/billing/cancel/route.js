import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import { cancelAsaasSubscription } from "../../../../lib/asaas";
import { BillingAccessError, ensureBillingAccount } from "../../../../lib/billing";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const account = await ensureBillingAccount(user);
    if (account.status !== "ACTIVE" || !["STUDIO", "AGENCY"].includes(account.plan)) {
      throw new BillingAccessError("Não há assinatura paga ativa para cancelar.", 409);
    }
    await cancelAsaasSubscription(account.providerSubscriptionId);
    await db.$transaction([
      db.billingAccount.update({ where: { id: account.id }, data: { status: "CANCELED", cancelAtPeriodEnd: true, pendingPlan: null } }),
      db.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.subscription.cancel", entityType: "BillingAccount", entityId: account.id, request }) }),
    ]);
    return NextResponse.json({ cancelled: true, accessUntil: account.cycleEndsAt });
  } catch (error) {
    return apiError(error);
  }
}
