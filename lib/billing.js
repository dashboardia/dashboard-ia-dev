import { db } from "./db.js";
import { aiModelRequiresPaidPlan, getAiModel } from "./ai-models.js";
import { getBillingPlan, planIsPaid } from "./billing-plans.js";
import { estimateExecutionCredits } from "./execution-credit-estimate.js";
import { getGlobalSettings } from "./global-settings.js";

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
    const existingPlan = await getBillingPlan(existing.plan, database);
    if (existing.status === "ACTIVE" && planIsPaid(existingPlan) && existing.cycleEndsAt && existing.cycleEndsAt <= new Date()) {
      return database.billingAccount.update({ where: { id: existing.id }, data: { status: "PAST_DUE" } });
    }
    return existing;
  }

  const now = new Date();
  const admin = user.globalRole === "ADMIN";
  const trialPlan = await getBillingPlan("TRIAL", database);
  const trialEndsAt = addDays(now, trialPlan.trialDays);
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
          granted: trialPlan.includedCredits,
          remaining: trialPlan.includedCredits,
          expiresAt: trialEndsAt,
          sourceRef: `trial:${trialIdentity(user)}`,
        },
      },
      creditTransactions: admin ? undefined : {
        create: {
          type: "GRANT",
          amount: trialPlan.includedCredits,
          balance: trialPlan.includedCredits,
          description: "Créditos do teste gratuito de 7 dias",
        },
      },
    },
  });
}

export async function reconcileCurrentCycleCredits(database, account) {
  const plan = account?.plan ? await getBillingPlan(account.plan, database) : null;
  if (!planIsPaid(plan) || account.status !== "ACTIVE") return null;
  if (!database.creditBucket?.findMany || !database.executionCreditReservation?.findMany) return null;

  const now = new Date();
  const [buckets, reservations] = await Promise.all([
    database.creditBucket.findMany({
      where: { accountId: account.id },
      orderBy: [{ createdAt: "asc" }, { expiresAt: "asc" }],
    }),
    database.executionCreditReservation.findMany({
      where: { accountId: account.id, status: "SETTLED", settledAt: { not: null } },
      select: { consumedCredits: true, settledAt: true },
      orderBy: { settledAt: "asc" },
    }),
  ]);

  if (!buckets.length) return null;
  if (buckets.some((bucket) => bucket.reserved > 0)) return null;

  const states = new Map(buckets.map((bucket) => [bucket.id, { ...bucket, remaining: 0 }]));
  const events = [
    ...buckets.map((bucket) => ({ type: "GRANT", at: new Date(bucket.createdAt), bucket })),
    ...reservations.map((reservation) => ({ type: "CONSUME", at: new Date(reservation.settledAt), credits: Math.max(0, reservation.consumedCredits) })),
  ].sort((left, right) => left.at - right.at || (left.type === "GRANT" ? -1 : 1));
  let expectedDebt = 0;
  for (const event of events) {
    for (const state of states.values()) {
      if (state.remaining > 0 && new Date(state.expiresAt) <= event.at) state.remaining = 0;
    }
    if (event.type === "GRANT") {
      const state = states.get(event.bucket.id);
      const debtPayment = Math.min(expectedDebt, event.bucket.granted);
      expectedDebt -= debtPayment;
      state.remaining = event.bucket.granted - debtPayment;
      continue;
    }

    let pendingConsumption = event.credits;
    const availableStates = [...states.values()]
      .filter((state) => state.remaining > 0 && new Date(state.createdAt) <= event.at && new Date(state.expiresAt) > event.at)
      .sort((left, right) => new Date(left.expiresAt) - new Date(right.expiresAt));
    for (const state of availableStates) {
      const consumed = Math.min(state.remaining, pendingConsumption);
      state.remaining -= consumed;
      pendingConsumption -= consumed;
      if (!pendingConsumption) break;
    }
    expectedDebt += pendingConsumption;
  }
  for (const state of states.values()) {
    if (new Date(state.expiresAt) <= now) state.remaining = 0;
  }
  const expectedRemaining = new Map([...states].map(([id, state]) => [id, state.remaining]));
  const changedBuckets = buckets.filter((bucket) => bucket.remaining !== expectedRemaining.get(bucket.id));
  if (!changedBuckets.length && account.creditDebt === expectedDebt) {
    return { changed: false, creditDebt: expectedDebt };
  }

  await Promise.all(changedBuckets.map((bucket) => database.creditBucket.update({
    where: { id: bucket.id },
    data: { remaining: expectedRemaining.get(bucket.id) },
  })));
  await database.billingAccount.update({ where: { id: account.id }, data: { creditDebt: expectedDebt } });
  await database.creditTransaction.create({
    data: {
      accountId: account.id,
      type: "ADJUSTMENT",
      amount: 0,
      description: "Reconciliação automática do saldo do ciclo",
      metadata: {
        previousDebt: account.creditDebt,
        reconciledDebt: expectedDebt,
        consumedCredits: reservations.reduce((total, reservation) => total + Math.max(0, reservation.consumedCredits), 0),
      },
    },
  });
  return { changed: true, creditDebt: expectedDebt };
}

export async function getBillingOverview(user, database = db) {
  let account = await ensureBillingAccount(user, database);
  const reconciliation = await reconcileCurrentCycleCredits(database, account);
  if (reconciliation?.changed) account = { ...account, creditDebt: reconciliation.creditDebt };
  const now = new Date();
  const buckets = await database.creditBucket.findMany({
    where: { accountId: account.id, expiresAt: { gt: now }, remaining: { gt: 0 } },
    orderBy: { expiresAt: "asc" },
  });
  const availableCredits = account.plan === "CUSTOM"
    ? null
    : Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - account.creditDebt);
  const projectCount = await database.project.count({ where: { createdById: user.id, status: { not: "ARCHIVED" } } });
  const plan = await getBillingPlan(account.plan, database);
  return {
    account,
    plan,
    availableCredits,
    reservedCredits: buckets.reduce((total, bucket) => total + bucket.reserved, 0),
    projectCount,
    subscriptionActive: billingAccessIsActive(account, now),
    accessActive: billingAccessIsActive(account, now) || Number(availableCredits) > 0,
    buckets,
  };
}

export async function assertCanCreateProject(user, database = db) {
  const overview = await getBillingOverview(user, database);
  if (user.globalRole === "ADMIN" || overview.account.plan === "CUSTOM") return overview;
  if (!overview.accessActive) throw new BillingAccessError("Seu teste terminou e não há créditos disponíveis. Recarregue via Pix ou cartão, ou escolha um plano para conectar novos projetos.");
  const accessPlan = overview.subscriptionActive ? overview.plan : await getBillingPlan("TRIAL", database);
  if (overview.projectCount >= accessPlan.projectLimit) {
    throw new BillingAccessError(`O acesso sem assinatura permite até ${accessPlan.projectLimit} projeto(s). Contrate um plano para ampliar esse limite.`, 402, "PROJECT_LIMIT");
  }
  return { ...overview, accessPlan };
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
  if (context.bypass || planIsPaid(context.plan)) return context;
  throw new BillingAccessError("Usuários adicionais estão disponíveis nos planos Studio e Agência.", 402, "MEMBER_LIMIT");
}

export async function getProjectBillingContext(projectId, database = db) {
  const project = await database.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { createdBy: { select: { id: true, githubLogin: true, globalRole: true } } },
  });
  const account = await ensureBillingAccount(project.createdBy, database);
  const billingPlan = await getBillingPlan(account.plan, database);
  if (project.createdBy.globalRole === "ADMIN" || account.plan === "CUSTOM") {
    return { account, plan: billingPlan, billingPlan, bypass: true, reservationCredits: 0, creditOnly: false };
  }
  const subscriptionActive = billingAccessIsActive(account);
  if (subscriptionActive) return { account, plan: billingPlan, billingPlan, bypass: false, creditOnly: false };

  const buckets = await database.creditBucket.findMany({
    where: { accountId: account.id, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
    select: { remaining: true, reserved: true },
  });
  const availableCredits = Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - account.creditDebt);
  if (!availableCredits) {
    throw new BillingAccessError("O teste terminou e não há créditos disponíveis. Recarregue via Pix ou cartão, ou escolha um plano para iniciar novas execuções.");
  }
  const freePlan = await getBillingPlan("TRIAL", database);
  return { account, plan: freePlan, billingPlan, bypass: false, creditOnly: true, availableCredits };
}

export function assertAiModelAccess(context, aiModel) {
  if (context.bypass || planIsPaid(context.plan) || !aiModelRequiresPaidPlan(aiModel)) return context;
  const model = getAiModel(aiModel);
  throw new BillingAccessError(`${model.model} está disponível nos planos Studio ou superiores. No plano gratuito, escolha GPT-5.6 Luna ou contrate um plano.`, 402, "AI_MODEL_PLAN_REQUIRED");
}

export async function assertProjectAiModelAccess(projectId, aiModel, database = db) {
  const context = await getProjectBillingContext(projectId, database);
  return assertAiModelAccess(context, aiModel);
}

export async function prepareExecutionBilling({ demand, database = db }) {
  const context = await getProjectBillingContext(demand.projectId, database);
  assertAiModelAccess(context, demand.aiModel);
  if (context.bypass) return context;
  const [settings, historicalReservations] = await Promise.all([
    getGlobalSettings(database),
    database.executionCreditReservation?.findMany
      ? database.executionCreditReservation.findMany({
        where: {
          status: "SETTLED",
          consumedCredits: { gt: 0 },
          execution: { model: demand.aiModel, demand: { type: demand.type } },
        },
        select: { consumedCredits: true },
        orderBy: { settledAt: "desc" },
        take: 30,
      })
      : [],
  ]);
  const reservationEstimate = estimateExecutionCredits({
    demand,
    historicalConsumedCredits: (historicalReservations ?? []).map((reservation) => reservation.consumedCredits),
    bufferPercent: settings.reservationBufferPercent,
  });
  const reservationCredits = reservationEstimate.credits;
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
  return { ...context, reservationCredits, reservationEstimate: reservationEstimate.metadata };
}

export async function chargeFixedProjectCredits({ projectId, credits, description, metadata, executionId = null }, database = db) {
  const normalizedCredits = Math.max(0, Math.ceil(Number(credits) || 0));
  const context = await getProjectBillingContext(projectId, database);
  if (context.bypass || !normalizedCredits) return { bypass: true, credits: 0, allocations: [], accountId: context.account.id };

  return database.$transaction(async (transaction) => {
    const buckets = await transaction.creditBucket.findMany({
      where: { accountId: context.account.id, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
      orderBy: { expiresAt: "asc" },
    });
    const available = Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - context.account.creditDebt);
    if (available < normalizedCredits) {
      throw new BillingAccessError(`Esta operação custa ${normalizedCredits} créditos e há ${available} disponíveis.`, 402, "INSUFFICIENT_CREDITS");
    }
    let pending = normalizedCredits;
    const allocations = [];
    for (const bucket of buckets) {
      const amount = Math.min(Math.max(0, bucket.remaining - bucket.reserved), pending);
      if (!amount) continue;
      await transaction.creditBucket.update({ where: { id: bucket.id }, data: { remaining: { decrement: amount } } });
      allocations.push({ bucketId: bucket.id, credits: amount });
      pending -= amount;
      if (!pending) break;
    }
    await transaction.creditTransaction.create({
      data: { accountId: context.account.id, executionId, type: "CONSUME", amount: -normalizedCredits, description, metadata },
    });
    return { bypass: false, credits: normalizedCredits, allocations, accountId: context.account.id };
  });
}

export async function reserveFixedProjectCredits({ projectId, credits, description, metadata }, database = db) {
  const normalizedCredits = Math.max(0, Math.ceil(Number(credits) || 0));
  const context = await getProjectBillingContext(projectId, database);
  if (context.bypass || !normalizedCredits) {
    return { bypass: true, status: "RESERVED", credits: 0, allocations: [], accountId: context.account.id };
  }

  return database.$transaction(async (transaction) => {
    const buckets = await transaction.creditBucket.findMany({
      where: { accountId: context.account.id, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
      orderBy: { expiresAt: "asc" },
    });
    const available = Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - context.account.creditDebt);
    if (available < normalizedCredits) {
      throw new BillingAccessError(`Esta operação precisa proteger ${normalizedCredits} créditos até a publicação concluir e há ${available} disponíveis.`, 402, "INSUFFICIENT_CREDITS");
    }
    let pending = normalizedCredits;
    const allocations = [];
    for (const bucket of buckets) {
      const amount = Math.min(Math.max(0, bucket.remaining - bucket.reserved), pending);
      if (!amount) continue;
      await transaction.creditBucket.update({ where: { id: bucket.id }, data: { reserved: { increment: amount } } });
      allocations.push({ bucketId: bucket.id, credits: amount });
      pending -= amount;
      if (!pending) break;
    }
    if (pending) throw new BillingAccessError("O saldo mudou enquanto o ambiente era criado. Tente novamente.", 409, "CREDIT_CONFLICT");
    await transaction.creditTransaction.create({
      data: { accountId: context.account.id, type: "RESERVE", amount: normalizedCredits, description, metadata },
    });
    return { bypass: false, status: "RESERVED", credits: normalizedCredits, allocations, accountId: context.account.id, metadata };
  });
}

export async function settleFixedCreditsInTransaction(transaction, reservation, description) {
  if (!reservation || reservation.bypass || reservation.status !== "RESERVED" || !reservation.credits) {
    return { ...reservation, status: "CHARGED" };
  }
  for (const allocation of reservation.allocations ?? []) {
    await transaction.creditBucket.update({
      where: { id: allocation.bucketId },
      data: { reserved: { decrement: allocation.credits }, remaining: { decrement: allocation.credits } },
    });
  }
  await transaction.creditTransaction.create({
    data: { accountId: reservation.accountId, type: "CONSUME", amount: -reservation.credits, description, metadata: reservation.metadata },
  });
  return { ...reservation, status: "CHARGED" };
}

export async function refundFixedCreditsInTransaction(transaction, charge, description) {
  if (!charge || charge.bypass || !charge.credits) return null;
  if (charge.status === "RESERVED") {
    for (const allocation of charge.allocations ?? []) {
      await transaction.creditBucket.update({ where: { id: allocation.bucketId }, data: { reserved: { decrement: allocation.credits } } });
    }
    return transaction.creditTransaction.create({
      data: { accountId: charge.accountId, type: "RELEASE", amount: charge.credits, description },
    });
  }
  for (const allocation of charge.allocations ?? []) {
    await transaction.creditBucket.update({ where: { id: allocation.bucketId }, data: { remaining: { increment: allocation.credits } } });
  }
  return transaction.creditTransaction.create({
    data: { accountId: charge.accountId, type: "ADJUSTMENT", amount: charge.credits, description },
  });
}

export async function refundFixedCredits(charge, description, database = db) {
  return database.$transaction((transaction) => refundFixedCreditsInTransaction(transaction, charge, description));
}

export async function reserveExecutionCredits(transaction, { accountId, executionId, credits, estimateMetadata = null }) {
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
  await transaction.creditTransaction.create({ data: { accountId, executionId, type: "RESERVE", amount: credits, description: "Estimativa reservada para a execução", metadata: estimateMetadata } });
  return transaction.executionCreditReservation.create({
    data: { accountId, executionId, reservedCredits: credits, allocations, estimateMetadata },
  });
}

export async function getExecutionCreditBudget(database, { executionId, marginPercent = 20 }) {
  if (!database.executionCreditReservation) return null;
  const reservation = await database.executionCreditReservation.findUnique({
    where: { executionId },
    include: { account: { select: { creditDebt: true } } },
  });
  if (!reservation || !["RESERVED", "SETTLED"].includes(reservation.status)) return null;

  const buckets = await database.creditBucket.findMany({
    where: { accountId: reservation.accountId, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
    select: { remaining: true, reserved: true },
  });
  const unreservedCredits = buckets.reduce((total, bucket) => total + Math.max(0, bucket.remaining - bucket.reserved), 0);
  const stillReservedCredits = reservation.status === "RESERVED" ? reservation.reservedCredits : 0;
  const availableCredits = Math.max(0, unreservedCredits + stillReservedCredits - (reservation.account?.creditDebt ?? 0));
  const normalizedMarginPercent = Math.min(100, Math.max(0, Number(marginPercent) || 0));
  const marginCredits = Math.ceil(availableCredits * normalizedMarginPercent / 100);

  return {
    reservedCredits: reservation.reservedCredits,
    availableCredits,
    marginPercent: normalizedMarginPercent,
    marginCredits,
    hardLimitCredits: Math.max(stillReservedCredits, availableCredits + marginCredits),
    previouslyConsumedCredits: reservation.consumedCredits ?? 0,
  };
}

export async function settleExecutionCredits(transaction, { executionId, consumedCredits }) {
  if (!transaction.executionCreditReservation) return null;
  const reservation = await transaction.executionCreditReservation.findUnique({ where: { executionId } });
  if (!reservation || !["RESERVED", "SETTLED"].includes(reservation.status)) return reservation;
  const allocations = Array.isArray(reservation.allocations) ? reservation.allocations : [];
  const measuredCredits = Math.max(0, Math.ceil(Number(consumedCredits) || 0));
  const previouslyConsumedCredits = Math.max(0, reservation.consumedCredits ?? 0);
  const incrementalCredits = reservation.status === "SETTLED"
    ? Math.max(0, measuredCredits - previouslyConsumedCredits)
    : measuredCredits;
  if (reservation.status === "SETTLED" && incrementalCredits === 0) return reservation;

  let remainingToConsume = incrementalCredits;
  let consumedFromBuckets = 0;
  if (reservation.status === "RESERVED") {
    for (const allocation of allocations) {
      const amount = Math.min(allocation.credits, remainingToConsume);
      await transaction.creditBucket.update({
        where: { id: allocation.bucketId },
        data: { reserved: { decrement: allocation.credits }, ...(amount ? { remaining: { decrement: amount } } : {}) },
      });
      consumedFromBuckets += amount;
      remainingToConsume -= amount;
    }
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
      consumedFromBuckets += amount;
      remainingToConsume -= amount;
      if (!remainingToConsume) break;
    }
  }

  const debtCredits = remainingToConsume;
  if (debtCredits) {
    await transaction.billingAccount.update({
      where: { id: reservation.accountId },
      data: { creditDebt: { increment: debtCredits } },
    });
  }
  if (incrementalCredits) await transaction.creditTransaction.create({
    data: {
      accountId: reservation.accountId,
      executionId,
      type: "CONSUME",
      amount: -incrementalCredits,
      description: reservation.status === "SETTLED" ? "Consumo medido da interação" : "Consumo medido da execução",
      metadata: {
        consumedFromBuckets,
        debtCredits,
        previousConsumedCredits: previouslyConsumedCredits,
        cumulativeConsumedCredits: previouslyConsumedCredits + incrementalCredits,
      },
    },
  });
  const released = reservation.status === "RESERVED"
    ? Math.max(0, reservation.reservedCredits - Math.min(reservation.reservedCredits, measuredCredits))
    : 0;
  if (released) await transaction.creditTransaction.create({ data: { accountId: reservation.accountId, executionId, type: "RELEASE", amount: released, description: "Saldo da reserva devolvido" } });
  return transaction.executionCreditReservation.update({
    where: { id: reservation.id },
    data: {
      status: previouslyConsumedCredits + incrementalCredits ? "SETTLED" : "RELEASED",
      consumedCredits: previouslyConsumedCredits + incrementalCredits,
      uncoveredCredits: (reservation.uncoveredCredits ?? 0) + debtCredits,
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

export async function activatePlan(transaction, { account, planCode, sourceRef, providerCustomerId, providerSubscriptionId, includedCredits = null }) {
  const plan = await getBillingPlan(planCode, transaction);
  const monthlyCredits = Math.max(0, Math.round(includedCredits ?? plan.includedCredits ?? 0));
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
      ...(providerCustomerId ? { providerCustomerId } : {}),
      ...(providerSubscriptionId ? { providerSubscriptionId } : {}),
    },
  });
  await grantCredits(transaction, {
    accountId: account.id,
    type: "MONTHLY",
    credits: monthlyCredits,
    expiresAt: cycleEndsAt,
    sourceRef: `plan:${sourceRef}`,
    description: `Créditos mensais do plano ${plan.name}`,
  });
  return updated;
}

export async function activatePlanUpgrade(transaction, { account, planCode, sourceRef, providerCustomerId = null, providerSubscriptionId = null }) {
  const plan = await getBillingPlan(planCode, transaction);
  const now = new Date();
  const cycleEndsAt = account.cycleEndsAt && account.cycleEndsAt > now ? account.cycleEndsAt : addMonths(now, 1);
  const updated = await transaction.billingAccount.update({
    where: { id: account.id },
    data: {
      plan: planCode,
      pendingPlan: null,
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      ...(providerCustomerId ? { providerCustomerId } : {}),
      ...(providerSubscriptionId ? { providerSubscriptionId } : {}),
    },
  });
  await grantCredits(transaction, {
    accountId: account.id,
    type: "MONTHLY",
    credits: Math.max(0, Math.round(plan.includedCredits || 0)),
    expiresAt: cycleEndsAt,
    sourceRef: `upgrade:${sourceRef}`,
    description: `Créditos adicionados no upgrade para ${plan.name}`,
  });
  return updated;
}

export { addDays, addMonths };
