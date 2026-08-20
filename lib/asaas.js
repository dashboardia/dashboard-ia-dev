import { env } from "./env.js";

function baseUrl() {
  return env.ASAAS_ENVIRONMENT === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

function checkoutPage(id) {
  const host = env.ASAAS_ENVIRONMENT === "production" ? "https://asaas.com" : "https://sandbox.asaas.com";
  return `${host}/checkoutSession/show?id=${encodeURIComponent(id)}`;
}

async function asaasRequest(path, options = {}) {
  if (!env.ASAAS_API_KEY) throw new Error("O checkout ainda não foi configurado. Informe ASAAS_API_KEY no Railway.");
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "DashboardIA",
      access_token: env.ASAAS_API_KEY,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.errors?.map((error) => error.description).filter(Boolean).join("; ") || "O Asaas recusou a operação";
    throw new Error(message);
  }
  return result;
}

function callbackUrls() {
  const origin = env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!origin) throw new Error("NEXTAUTH_URL é obrigatória para criar o checkout");
  return {
    successUrl: `${origin}/billing?checkout=success`,
    cancelUrl: `${origin}/billing?checkout=cancelled`,
    expiredUrl: `${origin}/billing?checkout=expired`,
  };
}

export async function createPlanCheckout({ orderId, plan }) {
  const result = await asaasRequest("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      externalReference: orderId,
      callback: callbackUrls(),
      items: [{ name: `Dashboard IA — ${plan.name}`, description: `${plan.includedCredits} créditos mensais`, quantity: 1, value: plan.priceCents / 100 }],
      subscription: { cycle: "MONTHLY", nextDueDate: new Date().toISOString().slice(0, 10) },
    }),
  });
  return { id: result.id, link: result.link || checkoutPage(result.id), status: result.status || "ACTIVE" };
}

export async function createCreditPackCheckout({ orderId, pack }) {
  const result = await asaasRequest("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["DETACHED"],
      minutesToExpire: 60,
      externalReference: orderId,
      callback: callbackUrls(),
      items: [{ name: `${pack.credits} créditos Dashboard IA`, description: `Créditos adicionais válidos por ${pack.validityMonths} meses`, quantity: 1, value: pack.priceCents / 100 }],
    }),
  });
  return { id: result.id, link: result.link || checkoutPage(result.id), status: result.status || "ACTIVE" };
}

export async function cancelAsaasSubscription(subscriptionId) {
  if (!subscriptionId) throw new Error("A assinatura ainda não foi conciliada com o Asaas. Aguarde o primeiro webhook de cobrança.");
  return asaasRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
}

export async function resolveAsaasSubscriptionId(subscriptionId, customerId) {
  if (subscriptionId) return subscriptionId;
  if (!customerId) throw new Error("A assinatura ainda não possui identificação conciliada no Asaas.");
  const query = new URLSearchParams({ customer: customerId, status: "ACTIVE", limit: "10", offset: "0" });
  const result = await asaasRequest(`/subscriptions?${query.toString()}`, { method: "GET" });
  const subscriptions = Array.isArray(result?.data) ? result.data : [];
  if (subscriptions.length === 0) throw new Error("Nenhuma assinatura ativa foi encontrada no Asaas para esta conta.");
  if (subscriptions.length > 1) throw new Error("Mais de uma assinatura ativa foi encontrada no Asaas. Regularize as assinaturas duplicadas antes da troca.");
  return subscriptions[0].id;
}

export async function updateAsaasSubscriptionPlan({ subscriptionId, customerId, plan }) {
  const resolvedSubscriptionId = await resolveAsaasSubscriptionId(subscriptionId, customerId);
  await asaasRequest(`/subscriptions/${encodeURIComponent(resolvedSubscriptionId)}`, {
    method: "PUT",
    body: JSON.stringify({
      value: plan.priceCents / 100,
      description: `Dashboard IA — ${plan.name}`,
      updatePendingPayments: true,
    }),
  });
  return resolvedSubscriptionId;
}
