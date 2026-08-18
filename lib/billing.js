import { db } from "./db.js";
import { executionReservationCredits, getBillingPlan } from "./billing-plans.js";

const ACTIVE_EXECUTION_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING"];

export class BillingAccessError extends Error {
  constructor(message, status = 402, code = "BILLING_REQUIRED") {
    super(message);
    this.name = "BillingAccessError";
    this.status = status;
    this.code = code;
  }
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function trialIdentity(user) {
  return `github:${(user.githubLogin || user.id).trim().toLowerCase()}`;
}

export function billingAccessIsActive(account, now = new Date()) {
  if (account.plan === "CUSTOM" && account.status === "ACTIVE") return true;
  if (account.status === "TRIALING") return Boolean(account.trialEndsAt && new Date(account.trialEndsAt) > now);
  if (account.status === "ACTIVE") return true;
  if (account.status === "CANCELED") return Boolean(account.cycleEndsAt && new Date(account.cycleEndsAt) > now);
  return false;
}

export async function ensureBillingAccount(user, database = db) {
  const existing = await database.billingAccount.findUnique({ where: { ownerUserId: user.id } });
  if (existing) {
    if (user.globalRole === "ADMIN" && (existing.plan !== "CUSTOM" || existing.status !== "ACTIVE")) {
      return database.billingAccount.update({ where: { id: existing.id }, data: { plan: "CUSTOM", status: "ACTIVE", creditDebt: 0 } });
    }
    if (existing.status === "TRIALING" && existing.trialEndsAt && existing.trialEndsAt <= new Date()) {
      return database.billingAccount.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
    }
    if (existing.status === "ACTIVE" && ["STUDIO", "AGENCY"].includes(existing.plan) && existing.cycleEndsAt && existing.cycleEndsAt <= new Date()) {
      return database.billingAccount.update({ where: { id: existing.id }, data: { status: "PAST_DUE" } });
    }
    return existing;
  }

  const now = new Date();
  const admin = user.globalRole === "ADMIN";
  const trialEndsAt = addDays(now, getBillingPlan("TRIAL").trialDays);
  return database.billingAccount.upsert({
    where: { ownerUserId: user.id },
    update: {},
    create: {
      ownerUserId: user.id,
      trialIdentity: admin ? `admin:${user.id}` : trialIdentity(user),
      plan: admin ? "CUSTOM" : "TRIAL",
      status: admin ? "ACTIVE" : "TRIALING",
      trialStartedAt: admin ? null : now,
      trialEndsAt: admin ? null : trialEndsAt,
      creditBuckets: admin ? undefined : {
        create: {
          type: "TRIAL",
          granted: getBillingPlan("TRIAL").includedCredits,
          remaining: getBillingPlan("TRIAL").includedCredits,
          expiresAt: trialEndsAt,
          sourceRef: `trial:${trialIdentity(user)}`,
        },
      },
      creditTransactions: admin ? undefined : {
        create: {
          type: "GRANT",
          amount: getBillingPlan("TRIAL").includedCredits,
          balance: getBillingPlan("TRIAL").includedCredits,
          description: "Créditos do teste gratuito de 7 dias",
        },
      },
    },
  });
}

export async function getBillingOverview(user, database = db) {
  const account = await ensureBillingAccount(user, database);
  const now = new Date();
  const buckets = await database.creditBucket.findMany({
    where: { accountId: account.id, expiresAt: { gt: now }, remaining: { gt: 0 } },
    orderBy: { expiresAt: "asc" },
  });
  const availableCredits = account.plan === "CUSTOM"
    ? null
    : Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - account.creditDebt);
  const projectCount = await database.project.count({ where: { createdById: user.id, status: { not: "ARCHIVED" } } });
  const plan = getBillingPlan(account.plan);
  return {
    account,
    plan,
    availableCredits,
    reservedCredits: buckets.reduce((total, bucket) => total + bucket.reserved, 0),
    projectCount,
    accessActive: billingAccessIsActive(account, now),
    buckets,
  };
}

export async function assertCanCreateProject(user, database = db) {
  const overview = await getBillingOverview(user, database);
  if (user.globalRole === "ADMIN" || overview.account.plan === "CUSTOM") return overview;
  if (!overview.accessActive) throw new BillingAccessError("Seu teste ou assinatura não está ativo. Escolha um plano para conectar novos projetos.");
  if (overview.projectCount >= overview.plan.projectLimit) {
    throw new BillingAccessError(`O plano ${overview.plan.name} permite até ${overview.plan.projectLimit} projeto(s). Faça upgrade para conectar outro repositório.`, 402, "PROJECT_LIMIT");
  }
  return overview;
}

export async function claimTrialOrganization(account, repositoryFullName, database = db) {
  if (account.plan !== "TRIAL") return null;
  const githubOwner = repositoryFullName.split("/")[0]?.trim().toLowerCase();
  if (!githubOwner) throw new BillingAccessError("Não foi possível identificar a organização do repositório.", 422, "INVALID_GITHUB_OWNER");
  const existing = await database.billingTrialOrganization.findUnique({ where: { githubOwner } });
  if (existing) {
    if (existing.accountId === account.id) return existing;
    throw new BillingAccessError("Esta organização do GitHub já utilizou o teste gratuito. Escolha um plano para conectar o repositório.", 402, "TRIAL_ALREADY_USED");
  }
  const claimed = await database.billingTrialOrganization.upsert({
    where: { githubOwner },
    update: {},
    create: { githubOwner, accountId: account.id },
  });
  if (claimed.accountId !== account.id) {
    throw new BillingAccessError("Esta organização do GitHub já utilizou o teste gratuito. Escolha um plano para conectar o repositório.", 402, "TRIAL_ALREADY_USED");
  }
  return claimed;
}

export async function assertCanAddProjectMember(projectId, database = db) {
  const context = await getProjectBillingContext(projectId, database);
  if (context.bypass || ["STUDIO", "AGENCY"].includes(context.account.plan)) return context;
  throw new BillingAccessError("Usuários adicionais estão disponíveis nos planos Studio e Agência.", 402, "MEMBER_LIMIT");
}

export async function getProjectBillingContext(projectId, database = db) {
  const project = await database.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { createdBy: { select: { id: true, githubLogin: true, globalRole: true } } },
  });
  const account = await ensureBillingAccount(project.createdBy, database);
  const plan = getBillingPlan(account.plan);
  if (project.createdBy.globalRole === "ADMIN" || account.plan === "CUSTOM") {
    return { account, plan, bypass: true, reservationCredits: 0 };
  }
  if (!billingAccessIsActive(account)) {
    throw new BillingAccessError("O teste terminou ou a assinatura está pendente. Escolha um plano para iniciar novas execuções.");
  }
  return { account, plan, bypass: false };
}

export async function prepareExecutionBilling({ demand, database = db }) {
  const context = await getProjectBillingContext(demand.projectId, database);
  if (context.bypass) return context;
  const reservationCredits = executionReservationCredits(demand.aiModel);
  const activeExecutions = await database.execution.count({
    where: {
      status: { in: ACTIVE_EXECUTION_STATUSES },
      cancelRequestedAt: null,
      demand: { project: { createdById: context.account.ownerUserId } },
    },
  });
  if (activeExecutions >= context.plan.parallelExecutionLimit) {
    throw new BillingAccessError(`O plano ${context.plan.name} permite ${context.plan.parallelExecutionLimit} execução(ões) simultânea(s). Aguarde uma execução terminar.`, 409, "PARALLEL_LIMIT");
  }
  const buckets = await database.creditBucket.findMany({
    where: { accountId: context.account.id, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
    select: { remaining: true, reserved: true },
  });
  const available = Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - context.account.creditDebt);
  if (available < reservationCredits) {
    throw new BillingAccessError(`Esta execução precisa reservar ${reservationCredits} créditos e há ${available} disponíveis. Adicione créditos ou escolha outro plano.`, 402, "INSUFFICIENT_CREDITS");
  }
  return { ...context, reservationCredits };
}

export async function reserveExecutionCredits(transaction, { accountId, executionId, credits }) {
  if (!credits) return null;
  const buckets = await transaction.creditBucket.findMany({
    where: { accountId, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
    orderBy: { expiresAt: "asc" },
  });
  let pending = credits;
  const allocations = [];
  for (const bucket of buckets) {
    const available = Math.max(0, bucket.remaining - bucket.reserved);
    const amount = Math.min(available, pending);
    if (!amount) continue;
    await transaction.creditBucket.update({ where: { id: bucket.id }, data: { reserved: { increment: amount } } });
    allocations.push({ bucketId: bucket.id, credits: amount });
    pending -= amount;
    if (!pending) break;
  }
  if (pending) throw new BillingAccessError("O saldo mudou enquanto a execução era criada. Tente novamente.", 409, "CREDIT_CONFLICT");
  await transaction.creditTransaction.create({ data: { accountId, executionId, type: "RESERVE", amount: credits, description: "Reserva máxima da execução" } });
  return transaction.executionCreditReservation.create({
    data: { accountId, executionId, reservedCredits: credits, allocations },
  });
}

export async function settleExecutionCredits(transaction, { executionId, consumedCredits }) {
  if (!transaction.executionCreditReservation) return null;
  const reservation = await transaction.executionCreditReservation.findUnique({ where: { executionId } });
  if (!reservation || reservation.status !== "RESERVED") return reservation;
  const allocations = Array.isArray(reservation.allocations) ? reservation.allocations : [];
  let remainingToConsume = Math.max(0, consumedCredits);
  let consumed = 0;
  for (const allocation of allocations) {
    const amount = Math.min(allocation.credits, remainingToConsume);
    await transaction.creditBucket.update({
      where: { id: allocation.bucketId },
      data: { reserved: { decrement: allocation.credits }, ...(amount ? { remaining: { decrement: amount } } : {}) },
    });
    consumed += amount;
    remainingToConsume -= amount;
  }

  if (remainingToConsume > 0) {
    const extraBuckets = await transaction.creditBucket.findMany({
      where: { accountId: reservation.accountId, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
      orderBy: { expiresAt: "asc" },
    });
    for (const bucket of extraBuckets) {
      const available = Math.max(0, bucket.remaining - bucket.reserved);
      const amount = Math.min(available, remainingToConsume);
      if (!amount) continue;
      await transaction.creditBucket.update({ where: { id: bucket.id }, data: { remaining: { decrement: amount } } });
      consumed += amount;
      remainingToConsume -= amount;
      if (!remainingToConsume) break;
    }
  }

  if (consumed) await transaction.creditTransaction.create({ data: { accountId: reservation.accountId, executionId, type: "CONSUME", amount: -consumed, description: "Consumo medido da execução" } });
  const released = Math.max(0, reservation.reservedCredits - Math.min(reservation.reservedCredits, consumedCredits));
  if (released) await transaction.creditTransaction.create({ data: { accountId: reservation.accountId, executionId, type: "RELEASE", amount: released, description: "Saldo da reserva devolvido" } });
  if (remainingToConsume) await transaction.billingAccount.update({ where: { id: reservation.accountId }, data: { creditDebt: { increment: remainingToConsume } } });
  return transaction.executionCreditReservation.update({
    where: { id: reservation.id },
    data: {
      status: consumedCredits ? "SETTLED" : "RELEASED",
      consumedCredits: consumed,
      uncoveredCredits: remainingToConsume,
      settledAt: new Date(),
    },
  });
}

export async function grantCredits(transaction, { accountId, type, credits, expiresAt, sourceRef, description }) {
  const existing = sourceRef ? await transaction.creditBucket.findUnique({ where: { sourceRef } }) : null;
  if (existing) return existing;
  const bucket = await transaction.creditBucket.create({
    data: { accountId, type, granted: credits, remaining: credits, expiresAt, sourceRef },
  });
  await transaction.creditTransaction.create({
    data: { accountId, bucketId: bucket.id, type: "GRANT", amount: credits, description, metadata: sourceRef ? { sourceRef } : undefined },
  });
  return bucket;
}

export async function activatePlan(transaction, { account, planCode, sourceRef, providerCustomerId, providerSubscriptionId }) {
  const plan = getBillingPlan(planCode);
  const now = new Date();
  const cycleEndsAt = addMonths(now, 1);
  const updated = await transaction.billingAccount.update({
    where: { id: account.id },
    data: {
      plan: planCode,
      pendingPlan: null,
      status: "ACTIVE",
      cycleStartedAt: now,
      cycleEndsAt,
      cancelAtPeriodEnd: false,
      creditDebt: 0,
      ...(providerCustomerId ? { providerCustomerId } : {}),
      ...(providerSubscriptionId ? { providerSubscriptionId } : {}),
    },
  });
  await grantCredits(transaction, {
    accountId: account.id,
    type: "MONTHLY",
    credits: plan.includedCredits,
    expiresAt: cycleEndsAt,
    sourceRef: `plan:${sourceRef}`,
    description: `Créditos mensais do plano ${plan.name}`,
  });
  return updated;
}

export { addDays, addMonths };
