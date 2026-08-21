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

function callbackUrls({ checkoutKind, orderId }) {
  const origin = env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!origin) throw new Error("NEXTAUTH_URL é obrigatória para criar o checkout");
  const checkout = checkoutKind === "CREDIT_PACK" ? "credits" : "plan";
  const order = encodeURIComponent(orderId);
  return {
    successUrl: `${origin}/billing?checkout=${checkout}&order=${order}`,
    cancelUrl: `${origin}/billing?checkout=cancelled`,
    expiredUrl: `${origin}/billing?checkout=expired`,
  };
}

function checkoutCustomerFields({ customerId, customerData } = {}) {
  if (customerId) return { customer: customerId };

  const normalized = Object.fromEntries(
    Object.entries(customerData || {})
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => [key, value.trim()]),
  );

  // O checkout hospedado do Asaas rejeita customerData parcial. Quando ainda
  // não temos um customer cadastrado, só enviamos customerData se todos os
  // campos obrigatórios estiverem disponíveis; caso contrário deixamos o Asaas
  // coletar os dados faltantes no próprio checkout.
  const requiredFields = [
    "name",
    "email",
    "cpfCnpj",
    "phoneNumber",
    "address",
    "addressNumber",
    "postalCode",
    "province",
  ];
  const complete = requiredFields.every((field) => normalized[field]);
  return complete ? { customerData: normalized } : {};
}

export async function createPlanCheckout({ orderId, plan, customerId = null, customerData = null }) {
  const result = await asaasRequest("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      externalReference: orderId,
      callback: callbackUrls({ checkoutKind: "PLAN", orderId }),
      ...checkoutCustomerFields({ customerId, customerData }),
      items: [{ name: `Dashboard IA — ${plan.name}`, description: `${plan.includedCredits} créditos mensais`, quantity: 1, value: plan.priceCents / 100 }],
      subscription: { cycle: "MONTHLY", nextDueDate: new Date().toISOString().slice(0, 10) },
    }),
  });
  return { id: result.id, link: result.link || checkoutPage(result.id), status: result.status || "ACTIVE" };
}

export async function createCreditPackCheckout({ orderId, pack, customerId = null, customerData = null }) {
  const result = await asaasRequest("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      billingTypes: ["PIX", "CREDIT_CARD"],
      chargeTypes: ["DETACHED"],
      minutesToExpire: 60,
      externalReference: orderId,
      callback: callbackUrls({ checkoutKind: "CREDIT_PACK", orderId }),
      ...checkoutCustomerFields({ customerId, customerData }),
      items: [{ name: `${pack.credits} créditos Dashboard IA`, description: `Créditos adicionais válidos por ${pack.validityMonths} meses`, quantity: 1, value: pack.priceCents / 100 }],
    }),
  });
  return { id: result.id, link: result.link || checkoutPage(result.id), status: result.status || "ACTIVE" };
}

export async function cancelAsaasSubscription(subscriptionId) {
  if (!subscriptionId) throw new Error("A assinatura ainda não foi conciliada com o Asaas. Aguarde o primeiro webhook de cobrança.");
  return asaasRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
}

export function asaasSubscriptionIdentityFromPayments(payments = []) {
  const subscriptionIds = [...new Set(payments.map((payment) => payment.subscription).filter(Boolean))];
  const customerIds = [...new Set(payments.map((payment) => payment.customer).filter(Boolean))];
  if (subscriptionIds.length > 1 || customerIds.length > 1) {
    throw new Error("O checkout está vinculado a mais de uma assinatura no Asaas e precisa de conciliação manual.");
  }
  return { subscriptionId: subscriptionIds[0] || null, customerId: customerIds[0] || null };
}

async function subscriptionIdentityFromCheckout(checkoutId) {
  if (!checkoutId) return {};
  const query = new URLSearchParams({ checkoutSession: checkoutId, limit: "10", offset: "0" });
  const result = await asaasRequest(`/payments?${query.toString()}`, { method: "GET" });
  return asaasSubscriptionIdentityFromPayments(Array.isArray(result?.data) ? result.data : []);
}

async function subscriptionIdentityFromExternalReference(externalReference) {
  if (!externalReference) return {};
  const query = new URLSearchParams({ externalReference, limit: "10", offset: "0" });
  const result = await asaasRequest(`/payments?${query.toString()}`, { method: "GET" });
  return asaasSubscriptionIdentityFromPayments(Array.isArray(result?.data) ? result.data : []);
}

async function subscriptionIdentityFromCheckouts(checkouts = []) {
  let customerId = null;
  for (const checkout of checkouts) {
    const resolvers = [
      () => subscriptionIdentityFromCheckout(checkout.providerCheckoutId),
      () => subscriptionIdentityFromExternalReference(checkout.id),
    ];
    for (const resolveIdentity of resolvers) {
      const identity = await resolveIdentity();
      if (identity.customerId && customerId && identity.customerId !== customerId) {
        throw new Error("Os pedidos históricos estão vinculados a clientes diferentes no Asaas e precisam de conciliação manual.");
      }
      customerId ||= identity.customerId;
      if (identity.subscriptionId) return { subscriptionId: identity.subscriptionId, customerId: identity.customerId || customerId };
    }
  }
  return { subscriptionId: null, customerId };
}

async function customerIdFromEmail(email) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const query = new URLSearchParams({ email: normalizedEmail, limit: "10", offset: "0" });
  const result = await asaasRequest(`/customers?${query.toString()}`, { method: "GET" });
  const customers = (Array.isArray(result?.data) ? result.data : [])
    .filter((customer) => customer.email?.trim().toLowerCase() === normalizedEmail);
  if (customers.length > 1) throw new Error("Mais de um cliente com este e-mail foi encontrado no Asaas. Regularize os cadastros duplicados antes do upgrade.");
  return customers[0]?.id || null;
}

export async function resolveAsaasSubscriptionIdentity({ subscriptionId, customerId, customerEmail, checkouts = [] }) {
  if (subscriptionId) return { subscriptionId, customerId: customerId || null };
  const checkoutIdentity = await subscriptionIdentityFromCheckouts(checkouts);
  const resolvedCustomerId = customerId || checkoutIdentity.customerId || await customerIdFromEmail(customerEmail);
  if (checkoutIdentity.subscriptionId) return { subscriptionId: checkoutIdentity.subscriptionId, customerId: resolvedCustomerId || null };
  if (!resolvedCustomerId) throw new Error("Não foi possível localizar a assinatura original no Asaas. O suporte precisa conciliar esse pagamento.");
  const query = new URLSearchParams({ customer: resolvedCustomerId, status: "ACTIVE", limit: "10", offset: "0" });
  const result = await asaasRequest(`/subscriptions?${query.toString()}`, { method: "GET" });
  const subscriptions = Array.isArray(result?.data) ? result.data : [];
  if (subscriptions.length === 0) throw new Error("Nenhuma assinatura ativa foi encontrada no Asaas para esta conta.");
  if (subscriptions.length > 1) throw new Error("Mais de uma assinatura ativa foi encontrada no Asaas. Regularize as assinaturas duplicadas antes da troca.");
  return { subscriptionId: subscriptions[0].id, customerId: resolvedCustomerId };
}

export async function resolveAsaasSubscriptionId(subscriptionId, customerId, checkoutId = null) {
  const checkouts = checkoutId ? [{ id: null, providerCheckoutId: checkoutId }] : [];
  return (await resolveAsaasSubscriptionIdentity({ subscriptionId, customerId, checkouts })).subscriptionId;
}

export async function updateAsaasSubscriptionPlan({ subscriptionId, customerId, customerEmail, checkouts, plan }) {
  const identity = await resolveAsaasSubscriptionIdentity({ subscriptionId, customerId, customerEmail, checkouts });
  await asaasRequest(`/subscriptions/${encodeURIComponent(identity.subscriptionId)}`, {
    method: "PUT",
    body: JSON.stringify({
      value: plan.priceCents / 100,
      description: `Dashboard IA — ${plan.name}`,
      updatePendingPayments: true,
    }),
  });
  return identity;
}
