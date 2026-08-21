import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import { createCreditPackCheckout, createPlanCheckout } from "../../../../lib/asaas";
import { BillingAccessError, ensureBillingAccount } from "../../../../lib/billing";
import { findBillingPlan, findCreditPack, getBillingPlan, planIsPaid } from "../../../../lib/billing-plans";
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
    const currentPlan = await getBillingPlan(account.plan);
    if (input.kind === "PLAN" && account.status === "ACTIVE" && planIsPaid(currentPlan)) {
      throw new BillingAccessError("Já existe uma assinatura ativa. Cancele a renovação atual antes de contratar outro plano.", 409, "ACTIVE_SUBSCRIPTION");
    }
    const plan = input.kind === "PLAN" ? await findBillingPlan(input.plan) : null;
    const pack = input.kind === "CREDIT_PACK" ? await findCreditPack(input.pack) : null;
    if (input.kind === "PLAN" && (!planIsPaid(plan) || !plan.active || !plan.public)) throw new BillingAccessError("Este plano não está disponível para contratação.", 404, "PLAN_UNAVAILABLE");
    if (input.kind === "CREDIT_PACK" && (!pack || !pack.active || !pack.public)) throw new BillingAccessError("Este pacote de créditos não está disponível.", 404, "PACK_UNAVAILABLE");
    const pendingCheckout = await db.billingCheckout.findFirst({
      where: { accountId: account.id, kind: input.kind, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (pendingCheckout?.providerLink) {
      const sameOffer = input.kind === "PLAN"
        ? pendingCheckout.targetPlan === plan.code && pendingCheckout.amountCents === plan.priceCents && pendingCheckout.creditAmount === plan.includedCredits
        : pendingCheckout.creditAmount === pack.credits && pendingCheckout.amountCents === pack.priceCents && pendingCheckout.creditValidityMonths === pack.validityMonths;
      if (sameOffer) return NextResponse.json({ checkoutUrl: pendingCheckout.providerLink, reused: true });
      throw new BillingAccessError("Já existe um checkout pendente. Conclua-o ou aguarde até uma hora para escolher outra oferta.", 409, "PENDING_CHECKOUT");
    }
    const order = await db.billingCheckout.create({
      data: {
        accountId: account.id,
        kind: input.kind,
        targetPlan: plan?.code,
        creditAmount: plan?.includedCredits ?? pack?.credits,
        creditValidityMonths: pack?.validityMonths,
        amountCents: plan?.priceCents ?? pack.priceCents,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    try {
      const payer = {
        customerId: account.providerCustomerId || null,
        customerData: {
          name: user.name || undefined,
          email: user.email || undefined,
        },
      };
      const checkout = plan
        ? await createPlanCheckout({ orderId: order.id, plan, ...payer })
        : await createCreditPackCheckout({ orderId: order.id, pack, ...payer });
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
