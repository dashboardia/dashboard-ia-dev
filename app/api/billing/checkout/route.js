import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import { createCreditPackCheckout, createPlanCheckout } from "../../../../lib/asaas";
import { BillingAccessError, ensureBillingAccount } from "../../../../lib/billing";
import { getBillingPlan, getCreditPack } from "../../../../lib/billing-plans";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { billingCheckoutSchema } from "../../../../lib/validation";

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = billingCheckoutSchema.parse(await request.json());
    const account = await ensureBillingAccount(user);
    if (user.globalRole === "ADMIN" || account.plan === "CUSTOM") throw new BillingAccessError("A conta administrativa não precisa contratar um plano.", 409);
    if (input.kind === "PLAN" && account.status === "ACTIVE" && ["STUDIO", "AGENCY"].includes(account.plan)) {
      throw new BillingAccessError("Já existe uma assinatura ativa. Cancele a renovação atual antes de contratar outro plano.", 409, "ACTIVE_SUBSCRIPTION");
    }
    if (input.kind === "CREDIT_PACK" && account.status !== "ACTIVE") {
      throw new BillingAccessError("Créditos adicionais exigem uma assinatura Studio ou Agência ativa.");
    }
    const plan = input.kind === "PLAN" ? getBillingPlan(input.plan) : null;
    const pack = input.kind === "CREDIT_PACK" ? getCreditPack(input.pack) : null;
    const pendingCheckout = await db.billingCheckout.findFirst({
      where: { accountId: account.id, kind: input.kind, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (pendingCheckout?.providerLink) {
      const sameOffer = input.kind === "PLAN"
        ? pendingCheckout.targetPlan === plan.code
        : pendingCheckout.creditAmount === pack.credits;
      if (sameOffer) return NextResponse.json({ checkoutUrl: pendingCheckout.providerLink, reused: true });
      throw new BillingAccessError("Já existe um checkout pendente. Conclua-o ou aguarde até uma hora para escolher outra oferta.", 409, "PENDING_CHECKOUT");
    }
    const order = await db.billingCheckout.create({
      data: {
        accountId: account.id,
        kind: input.kind,
        targetPlan: plan?.code,
        creditAmount: pack?.credits,
        amountCents: plan?.priceCents ?? pack.priceCents,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    try {
      const checkout = plan
        ? await createPlanCheckout({ orderId: order.id, plan })
        : await createCreditPackCheckout({ orderId: order.id, pack });
      await db.$transaction([
        db.billingCheckout.update({ where: { id: order.id }, data: { providerCheckoutId: checkout.id, providerLink: checkout.link } }),
        db.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.checkout.create", entityType: "BillingCheckout", entityId: order.id, metadata: input, request }) }),
      ]);
      return NextResponse.json({ checkoutUrl: checkout.link });
    } catch (error) {
      await db.billingCheckout.update({ where: { id: order.id }, data: { status: "FAILED" } }).catch(() => null);
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
