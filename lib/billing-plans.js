export const BILLING_PLANS = {
  TRIAL: {
    code: "TRIAL",
    name: "Teste",
    priceCents: 0,
    includedCredits: 300,
    projectLimit: 1,
    parallelExecutionLimit: 1,
    trialDays: 7,
  },
  STUDIO: {
    code: "STUDIO",
    name: "Studio",
    priceCents: 29_700,
    includedCredits: 3_000,
    projectLimit: 5,
    parallelExecutionLimit: 2,
  },
  AGENCY: {
    code: "AGENCY",
    name: "Agência",
    priceCents: 69_700,
    includedCredits: 7_000,
    projectLimit: 20,
    parallelExecutionLimit: 5,
  },
  CUSTOM: {
    code: "CUSTOM",
    name: "Sob medida",
    priceCents: null,
    includedCredits: null,
    projectLimit: null,
    parallelExecutionLimit: null,
  },
};

export const CREDIT_PACKS = [
  { code: "CREDITS_1000", credits: 1_000, priceCents: 10_000 },
  { code: "CREDITS_3000", credits: 3_000, priceCents: 30_000 },
  { code: "CREDITS_7000", credits: 7_000, priceCents: 70_000 },
];

export const EXECUTION_RESERVATION_CREDITS = {
  "gpt-5.6-luna": 75,
  "gpt-5.6-terra": 300,
  "gpt-5.6-sol": 700,
};

export function getBillingPlan(plan) {
  return BILLING_PLANS[plan] ?? BILLING_PLANS.TRIAL;
}

export function getCreditPack(code) {
  return CREDIT_PACKS.find((pack) => pack.code === code) ?? null;
}

export function executionReservationCredits(model) {
  return EXECUTION_RESERVATION_CREDITS[model] ?? EXECUTION_RESERVATION_CREDITS["gpt-5.6-terra"];
}

export function formatPlanPrice(cents) {
  if (cents == null) return "Fale conosco";
  if (cents === 0) return "Grátis";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);
}
