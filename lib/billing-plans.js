import { db } from "./db.js";

export const DEFAULT_BILLING_PLANS = {
  TRIAL: { code: "TRIAL", name: "Teste", description: "Acesso gratuito para conhecer a plataforma.", priceCents: 0, includedCredits: 300, projectLimit: 1, parallelExecutionLimit: 1, trialDays: 7, active: true, public: false, structural: true, sortOrder: 0 },
  STUDIO: { code: "STUDIO", name: "Studio", description: "Para profissionais e operações menores.", priceCents: 29_700, includedCredits: 3_000, projectLimit: 5, parallelExecutionLimit: 2, trialDays: null, active: true, public: true, structural: true, sortOrder: 10 },
  AGENCY: { code: "AGENCY", name: "Agência", description: "Para operações com mais projetos em paralelo.", priceCents: 69_700, includedCredits: 7_000, projectLimit: 20, parallelExecutionLimit: 5, trialDays: null, active: true, public: true, structural: true, sortOrder: 20 },
  CUSTOM: { code: "CUSTOM", name: "Sob medida", description: "Limites personalizados para contratos especiais.", priceCents: null, includedCredits: null, projectLimit: null, parallelExecutionLimit: null, trialDays: null, active: true, public: false, structural: true, sortOrder: 100 },
};

// Compatibilidade para módulos puros e testes que não inicializam o banco.
export const BILLING_PLANS = DEFAULT_BILLING_PLANS;
export const CREDIT_PACK_SIZES = [1_000, 3_000, 7_000];

export function getCreditPacks(creditValueCents = 10) {
  const unitValue = Math.max(1, Math.round(Number(creditValueCents) || 10));
  return CREDIT_PACK_SIZES.map((credits) => ({ code: `CREDITS_${credits}`, credits, priceCents: credits * unitValue }));
}

export const CREDIT_PACKS = getCreditPacks();

export const EXECUTION_RESERVATION_CREDITS = {
  "gpt-5.6-luna": 75,
  "gpt-5.6-terra": 300,
  "gpt-5.6-sol": 700,
};

function normalizedPlan(plan) {
  return plan ? { ...plan } : null;
}

export function planIsPaid(plan) {
  return Boolean(plan?.priceCents > 0 && plan.includedCredits > 0);
}

export async function listBillingPlans(database = db, { includeInactive = true, publicOnly = false } = {}) {
  if (!database?.billingPlanCatalog?.findMany) {
    return Object.values(DEFAULT_BILLING_PLANS)
      .filter((plan) => includeInactive || plan.active)
      .filter((plan) => !publicOnly || plan.public)
      .map(normalizedPlan);
  }
  return database.billingPlanCatalog.findMany({
    where: {
      ...(!includeInactive ? { active: true } : {}),
      ...(publicOnly ? { public: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function findBillingPlan(code, database = db) {
  if (!code) return null;
  if (database?.billingPlanCatalog?.findUnique) {
    const plan = await database.billingPlanCatalog.findUnique({ where: { code } });
    if (plan) return plan;
  }
  return normalizedPlan(DEFAULT_BILLING_PLANS[code]);
}

export async function getBillingPlan(code, database = db) {
  return (await findBillingPlan(code, database)) ?? normalizedPlan(DEFAULT_BILLING_PLANS.TRIAL);
}

export function getCreditPack(code, creditValueCents = 10) {
  return getCreditPacks(creditValueCents).find((pack) => pack.code === code) ?? null;
}

export function executionReservationCredits(model) {
  return EXECUTION_RESERVATION_CREDITS[model] ?? EXECUTION_RESERVATION_CREDITS["gpt-5.6-terra"];
}

export function formatPlanPrice(cents, maximumFractionDigits = 0) {
  if (cents == null) return "Fale conosco";
  if (cents === 0) return "Grátis";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: maximumFractionDigits ? Math.min(2, maximumFractionDigits) : 0, maximumFractionDigits }).format(cents / 100);
}

export function effectiveCreditValueCents(plan) {
  if (!plan?.priceCents || !plan?.includedCredits) return null;
  return plan.priceCents / plan.includedCredits;
}
