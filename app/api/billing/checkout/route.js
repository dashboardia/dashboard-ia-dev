import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/access";
import {
  ASAAS_CHECKOUT_EXPIRATION_MINUTES,
  createCreditPackCheckout,
  createPlanCheckout,
  resolveAsaasCustomerId,
} from "../../../../lib/asaas";
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

    const now = new Date();
    const staleCutoff = new Date(now.getTime() - ASAAS_CHECKOUT_EXPIRATION_MINUTES * 60_000);
    await db.billingCheckout.updateMany({
      where: {
        accountId: account.id,
        status: "PENDING",
        OR: [
          { expiresAt: { lte: now } },
          { createdAt: { lt: staleCutoff } },
        ],
      },
      data: { status: "EXPIRED" },
    });

    const pendingCheckout = await db.billingCheckout.findFirst({
      where: {
        accountId: account.id,
        kind: input.kind,
        status: "PENDING",
        expiresAt: { gt: now },
        createdAt: { gte: staleCutoff },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pendingCheckout?.providerLink) {
      const sameOffer = input.kind === "PLAN"
        ? pendingCheckout.targetPlan === plan.code && pendingCheckout.amountCents === plan.priceCents && pendingCheckout.creditAmount === plan.includedCredits
        : pendingCheckout.creditAmount === pack.credits && pendingCheckout.amountCents === pack.priceCents && pendingCheckout.creditValidityMonths === pack.validityMonths;
      if (sameOffer) return NextResponse.json({ checkoutUrl: pendingCheckout.providerLink, reused: true });
      throw new BillingAccessError(`Já existe um checkout pendente. Conclua-o ou aguarde até ${ASAAS_CHECKOUT_EXPIRATION_MINUTES} minutos para escolher outra oferta.`, 409, "PENDING_CHECKOUT");
    }

    const historicalCheckouts = account.providerCustomerId ? [] : await db.billingCheckout.findMany({
      where: { accountId: account.id, status: "PAID", providerCheckoutId: { not: null } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 12,
      select: { id: true, providerCheckoutId: true },
    });
    const resolvedCustomerId = account.providerCustomerId || await resolveAsaasCustomerId({
      customerEmail: user.email,
      checkouts: historicalCheckouts,
    }).catch(() => null);
    if (resolvedCustomerId && !account.providerCustomerId) {
      await db.billingAccount.update({ where: { id: account.id }, data: { providerCustomerId: resolvedCustomerId } }).catch(() => null);
    }

    const order = await db.billingCheckout.create({
      data: {
        accountId: account.id,
        kind: input.kind,
        targetPlan: plan?.code,
        creditAmount: plan?.includedCredits ?? pack?.credits,
        creditValidityMonths: pack?.validityMonths,
        amountCents: plan?.priceCents ?? pack.priceCents,
        expiresAt: new Date(now.getTime() + ASAAS_CHECKOUT_EXPIRATION_MINUTES * 60_000),
      },
    });
    try {
      const checkout = plan
        ? await createPlanCheckout({ orderId: order.id, plan, customerId: resolvedCustomerId, returnTo: input.returnTo })
        : await createCreditPackCheckout({ orderId: order.id, pack, customerId: resolvedCustomerId, returnTo: input.returnTo });
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
