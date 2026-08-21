import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { asaasCheckoutCustomerId, asaasCheckoutLookup } from "../../../../lib/asaas-webhook";
import { activatePlan, addMonths, grantCredits } from "../../../../lib/billing";
import { db } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { getBillingPlan, planIsPaid } from "../../../../lib/billing-plans";

function tokenIsValid(received) {
  if (!env.ASAAS_WEBHOOK_TOKEN || !received) return false;
  const expectedBuffer = Buffer.from(env.ASAAS_WEBHOOK_TOKEN);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function processCheckoutEvent(transaction, payload) {
  const where = asaasCheckoutLookup(payload);
  if (!where) throw new Error("Evento de checkout do Asaas sem identificadores para conciliacao");
  const order = await transaction.billingCheckout.findFirst({
    where,
    include: { account: true },
  });
  if (!order) throw new Error(`Checkout do Asaas nao conciliado: ${payload.checkout?.id || "sem-id"}`);
  if (payload.event === "CHECKOUT_CANCELED") {
    await transaction.billingCheckout.update({ where: { id: order.id }, data: { status: "CANCELED" } });
    return { action: "checkout_canceled", checkoutId: order.id };
  }
  if (payload.event === "CHECKOUT_EXPIRED") {
    await transaction.billingCheckout.update({ where: { id: order.id }, data: { status: "EXPIRED" } });
    return { action: "checkout_expired", checkoutId: order.id };
  }
  if (payload.event !== "CHECKOUT_PAID") return { action: "checkout_ignored", checkoutId: order.id };

  const providerCustomerId = asaasCheckoutCustomerId(payload);
  const providerSubscriptionId = payload.checkout?.subscription?.id || payload.checkout?.subscriptionId || null;
  if (order.kind === "PLAN") {
    const planIsActive = order.account.status === "ACTIVE" && order.account.plan === order.targetPlan;
    if (!planIsActive) {
      await activatePlan(transaction, {
        account: order.account,
        planCode: order.targetPlan,
        sourceRef: order.id,
        providerCustomerId,
        providerSubscriptionId,
        includedCredits: order.creditAmount,
      });
    }
  } else {
    await grantCredits(transaction, {
      accountId: order.accountId,
      type: "ADDITIONAL",
      credits: order.creditAmount,
      expiresAt: addMonths(new Date(), Math.max(1, order.creditValidityMonths || 12)),
      sourceRef: `pack:${order.id}`,
      description: `Créditos adicionais válidos por ${Math.max(1, order.creditValidityMonths || 12)} meses`,
    });
    if (providerCustomerId && !order.account.providerCustomerId) {
      await transaction.billingAccount.update({ where: { id: order.accountId }, data: { providerCustomerId } });
    }
  }
  if (order.status !== "PAID") {
    await transaction.billingCheckout.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
  }
  return {
    action: order.kind === "PLAN" ? "plan_activated" : "credits_granted",
    checkoutId: order.id,
    plan: order.targetPlan,
  };
}

async function processPaymentEvent(transaction, payload) {
  const payment = payload.payment;
  if (!payment) return;
  const accountFilters = [
    payment.subscription ? { providerSubscriptionId: payment.subscription } : null,
    payment.customer ? { providerCustomerId: payment.customer } : null,
  ].filter(Boolean);
  const account = accountFilters.length
    ? await transaction.billingAccount.findFirst({ where: { OR: accountFilters } })
    : null;
  if (!account) return;
  if (!payment.subscription) return;
  if (!account.providerSubscriptionId && payment.subscription) {
    await transaction.billingAccount.update({ where: { id: account.id }, data: { providerSubscriptionId: payment.subscription } });
  }
  if (["PAYMENT_OVERDUE", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED"].includes(payload.event)) {
    await transaction.billingAccount.update({ where: { id: account.id }, data: { status: "PAST_DUE" } });
    return;
  }
  if (!["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(payload.event)) return;
  const cycleIsRenewal = !account.cycleStartedAt || account.cycleStartedAt < new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  const renewalPlan = account.pendingPlan || account.plan;
  const renewalPlanDefinition = await getBillingPlan(renewalPlan, transaction);
  if (cycleIsRenewal && planIsPaid(renewalPlanDefinition)) {
    await activatePlan(transaction, {
      account,
      planCode: renewalPlan,
      sourceRef: `payment:${payment.id}`,
      providerCustomerId: payment.customer,
      providerSubscriptionId: payment.subscription,
    });
  } else if (account.status === "PAST_DUE") {
    await transaction.billingAccount.update({ where: { id: account.id }, data: { status: "ACTIVE" } });
  }
}

export async function POST(request) {
  const token = request.headers.get("asaas-access-token");
  if (!tokenIsValid(token)) return NextResponse.json({ error: "Webhook não autorizado" }, { status: 401 });
  const payload = await request.json().catch(() => null);
  if (!payload?.id || !payload?.event) return NextResponse.json({ error: "Evento inválido" }, { status: 400 });

  try {
    const result = await db.$transaction(async (transaction) => {
      const existing = await transaction.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "ASAAS", providerEventId: payload.id } },
      });
      if (existing?.processedAt && !payload.event.startsWith("CHECKOUT_")) return { action: "event_deduplicated" };
      const event = existing || await transaction.billingWebhookEvent.create({
        data: { provider: "ASAAS", providerEventId: payload.id, eventType: payload.event, payload },
      });
      try {
        const checkout = payload.event.startsWith("CHECKOUT_")
          ? await processCheckoutEvent(transaction, payload)
          : null;
        if (payload.event.startsWith("PAYMENT_")) await processPaymentEvent(transaction, payload);
        await transaction.billingWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
        return checkout || { action: "event_processed" };
      } catch (error) {
        await transaction.billingWebhookEvent.update({ where: { id: event.id }, data: { error: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
    });
    return NextResponse.json({ received: true, result });
  } catch (error) {
    console.error("[asaas-webhook] Falha ao processar evento", error);
    return NextResponse.json({ error: "Falha temporária ao processar evento" }, { status: 500 });
  }
}
