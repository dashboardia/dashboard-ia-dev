import { describe, expect, it, vi } from "vitest";

import { activatePlanUpgrade, assertAiModelAccess, assertCanCreateProject, billingAccessIsActive, chargeFixedProjectCredits, claimTrialOrganization, ensureBillingAccount, getExecutionCreditBudget, reconcileCurrentCycleCredits, settleExecutionCredits } from "./billing";
import { BILLING_PLANS, CREDIT_PACKS, executionReservationCredits, getCreditPacks, planChangeKind, sortBillingPlans, sortCreditPacks } from "./billing-plans";

describe("billing plans", () => {
  it("preserva os preços, limites e créditos aprovados", () => {
    expect(BILLING_PLANS.TRIAL).toMatchObject({ includedCredits: 300, projectLimit: 1, parallelExecutionLimit: 1, trialDays: 7 });
    expect(BILLING_PLANS.STUDIO).toMatchObject({ priceCents: 29_700, includedCredits: 3_000, projectLimit: 5, parallelExecutionLimit: 2 });
    expect(BILLING_PLANS.AGENCY).toMatchObject({ priceCents: 69_700, includedCredits: 7_000, projectLimit: 20, parallelExecutionLimit: 5 });
    expect(CREDIT_PACKS.every((pack) => pack.priceCents === pack.credits * 10)).toBe(true);
    expect(getCreditPacks(14).every((pack) => pack.priceCents === pack.credits * 14)).toBe(true);
  });

  it("reserva mais créditos para modelos de maior custo", () => {
    expect(executionReservationCredits("gpt-5.6-luna")).toBe(75);
    expect(executionReservationCredits("gpt-5.6-terra")).toBe(300);
    expect(executionReservationCredits("gpt-5.6-sol")).toBe(700);
  });

  it("diferencia upgrade imediato de downgrade para o próximo ciclo", () => {
    expect(planChangeKind(BILLING_PLANS.STUDIO, BILLING_PLANS.AGENCY)).toBe("UPGRADE");
    expect(planChangeKind(BILLING_PLANS.AGENCY, BILLING_PLANS.STUDIO)).toBe("DOWNGRADE");
    expect(planChangeKind(BILLING_PLANS.STUDIO, { ...BILLING_PLANS.STUDIO, code: "GO", priceCents: 5_000, includedCredits: 1_000 })).toBe("DOWNGRADE");
  });

  it("ordena planos e créditos adicionais pelo menor preço", () => {
    const plans = sortBillingPlans([
      { code: "STUDIO", name: "Studio", priceCents: 29_700, includedCredits: 6_000 },
      { code: "AGENCY", name: "Agência", priceCents: 69_700, includedCredits: 14_000 },
      { code: "GO", name: "Go", priceCents: 5_000, includedCredits: 1_000 },
    ]);
    expect(plans.map((plan) => plan.code)).toEqual(["GO", "STUDIO", "AGENCY"]);

    const packs = sortCreditPacks([
      { code: "LARGE", name: "Grande", priceCents: 20_000, credits: 2_000 },
      { code: "SMALL", name: "Pequeno", priceCents: 5_000, credits: 500 },
    ]);
    expect(packs.map((pack) => pack.code)).toEqual(["SMALL", "LARGE"]);
  });

  it("limita o plano gratuito à Luna e libera os modelos nos planos pagos", () => {
    const free = { bypass: false, plan: BILLING_PLANS.TRIAL };
    expect(assertAiModelAccess(free, "gpt-5.6-luna")).toBe(free);
    expect(() => assertAiModelAccess(free, "gpt-5.6-terra")).toThrow(/Studio.*Luna/);
    expect(() => assertAiModelAccess(free, "gpt-5.6-sol")).toThrow(/Studio.*Luna/);
    expect(assertAiModelAccess({ bypass: false, plan: BILLING_PLANS.STUDIO }, "gpt-5.6-sol")).toMatchObject({ plan: BILLING_PLANS.STUDIO });
    expect(assertAiModelAccess({ bypass: true, plan: BILLING_PLANS.TRIAL }, "gpt-5.6-sol")).toMatchObject({ bypass: true });
  });
});

describe("billing access", () => {
  it("mantém teste e cancelamento ativos somente até suas datas finais", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    expect(billingAccessIsActive({ plan: "TRIAL", status: "TRIALING", trialEndsAt: new Date("2026-08-19T12:00:00Z") }, now)).toBe(true);
    expect(billingAccessIsActive({ plan: "TRIAL", status: "TRIALING", trialEndsAt: new Date("2026-08-17T12:00:00Z") }, now)).toBe(false);
    expect(billingAccessIsActive({ plan: "STUDIO", status: "CANCELED", cycleEndsAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe(true);
    expect(billingAccessIsActive({ plan: "STUDIO", status: "PAST_DUE", cycleEndsAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe(false);
  });

  it("cria teste único com 300 créditos para usuário comum", async () => {
    const database = {
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(async ({ create }) => ({ id: "account-1", ...create })),
      },
    };
    const account = await ensureBillingAccount({ id: "user-1", githubLogin: "CamilaDev", globalRole: "USER" }, database);
    expect(account.plan).toBe("TRIAL");
    expect(account.status).toBe("TRIALING");
    expect(account.trialIdentity).toBe("github:camiladev");
    expect(account.creditBuckets.create.granted).toBe(300);
    expect(database.billingAccount.upsert).toHaveBeenCalledTimes(1);
  });

  it("impede que outra conta reutilize o teste da mesma organização GitHub", async () => {
    const database = {
      billingTrialOrganization: {
        findUnique: vi.fn().mockResolvedValue({ accountId: "account-original" }),
      },
    };
    await expect(claimTrialOrganization({ id: "account-new", plan: "TRIAL" }, "empresa/projeto", database)).rejects.toMatchObject({ code: "TRIAL_ALREADY_USED", status: 402 });
  });

  it("conta somente projetos não arquivados ao aplicar o limite", async () => {
    const database = {
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "account-1",
          ownerUserId: "user-1",
          plan: "TRIAL",
          status: "TRIALING",
          trialEndsAt: new Date(Date.now() + 86_400_000),
          creditDebt: 0,
        }),
      },
      creditBucket: { findMany: vi.fn().mockResolvedValue([]) },
      project: { count: vi.fn().mockResolvedValue(1) },
    };

    await expect(assertCanCreateProject({ id: "user-1", globalRole: "USER" }, database)).rejects.toMatchObject({ code: "PROJECT_LIMIT" });
    expect(database.project.count).toHaveBeenCalledWith({
      where: { createdById: "user-1", status: { not: "ARCHIVED" } },
    });
  });
});

describe("credit settlement", () => {
  it("soma os créditos do upgrade sem encerrar nem substituir o saldo atual", async () => {
    const cycleEndsAt = new Date("2026-09-20T12:00:00Z");
    const transaction = {
      billingAccount: { update: vi.fn().mockResolvedValue({ id: "account-1", plan: "AGENCY" }) },
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "upgrade-bucket", granted: 7_000, remaining: 7_000 }),
      },
      creditTransaction: { create: vi.fn() },
    };

    await activatePlanUpgrade(transaction, {
      account: { id: "account-1", plan: "STUDIO", cycleEndsAt },
      planCode: "AGENCY",
      sourceRef: "account-1:cycle:AGENCY",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
    });

    expect(transaction.billingAccount.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: { plan: "AGENCY", pendingPlan: null, status: "ACTIVE", cancelAtPeriodEnd: false, providerCustomerId: "cus_1", providerSubscriptionId: "sub_1" },
    });
    expect(transaction.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: "account-1", type: "MONTHLY", granted: 7_000, remaining: 7_000, expiresAt: cycleEndsAt, sourceRef: "upgrade:account-1:cycle:AGENCY" }),
    });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 7_000, description: "Créditos adicionados no upgrade para Agência" }) });
  });

  it("vincula a cobrança fixa da interação à execução", async () => {
    const database = {
      project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ createdBy: { id: "user-1", githubLogin: "camila", globalRole: "USER" } }) },
      billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: "account-1", ownerUserId: "user-1", plan: "STUDIO", status: "ACTIVE", creditDebt: 0 }) },
      creditBucket: {
        findMany: vi.fn().mockResolvedValue([{ id: "bucket-1", remaining: 100, reserved: 0, expiresAt: new Date(Date.now() + 86_400_000) }]),
        update: vi.fn(),
      },
      creditTransaction: { create: vi.fn() },
      $transaction: vi.fn((callback) => callback(database)),
    };

    await chargeFixedProjectCredits({ projectId: "project-1", executionId: "execution-1", credits: 25, description: "Interação na execução" }, database);

    expect(database.creditBucket.update).toHaveBeenCalledWith({ where: { id: "bucket-1" }, data: { remaining: { decrement: 25 } } });
    expect(database.creditTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: "account-1", executionId: "execution-1", amount: -25 }) });
  });

  it("reconcilia dívida inflada por reservas paralelas usando concessões e consumo do ciclo", async () => {
    const account = {
      id: "account-1",
      plan: "STUDIO",
      status: "ACTIVE",
      cycleStartedAt: new Date("2026-08-18T00:00:00Z"),
      creditDebt: 1_894,
    };
    const database = {
      creditBucket: {
        findMany: vi.fn().mockResolvedValue([
          { id: "trial", granted: 300, remaining: 0, reserved: 0, createdAt: new Date("2026-08-11T00:00:00Z"), expiresAt: new Date("2026-08-25T00:00:00Z") },
          { id: "monthly", granted: 3_000, remaining: 894, reserved: 0, createdAt: new Date("2026-08-18T00:00:01Z"), expiresAt: new Date("2026-09-18T00:00:00Z") },
          { id: "pack", granted: 1_000, remaining: 1_000, reserved: 0, createdAt: new Date("2026-08-19T00:00:00Z"), expiresAt: new Date("2027-08-19T00:00:00Z") },
        ]),
        update: vi.fn(),
      },
      executionCreditReservation: {
        findMany: vi.fn().mockResolvedValue([
          { consumedCredits: 1_894, settledAt: new Date("2026-08-18T01:00:00Z") },
          { consumedCredits: 653, settledAt: new Date("2026-08-18T02:00:00Z") },
          { consumedCredits: 592, settledAt: new Date("2026-08-18T03:00:00Z") },
          { consumedCredits: 70, settledAt: new Date("2026-08-18T04:00:00Z") },
          { consumedCredits: 46, settledAt: new Date("2026-08-18T05:00:00Z") },
          { consumedCredits: 45, settledAt: new Date("2026-08-18T06:00:00Z") },
        ]),
      },
      billingAccount: { update: vi.fn() },
      creditTransaction: { create: vi.fn() },
    };

    await expect(reconcileCurrentCycleCredits(database, account)).resolves.toEqual({ changed: true, creditDebt: 0 });
    expect(database.creditBucket.update).toHaveBeenCalledWith({ where: { id: "monthly" }, data: { remaining: 0 } });
    expect(database.creditBucket.update).toHaveBeenCalledTimes(1);
    expect(database.billingAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { creditDebt: 0 } });
  });

  it("calcula o teto pelo saldo total mais a margem, não pela reserva", async () => {
    const database = {
      executionCreditReservation: {
        findUnique: vi.fn().mockResolvedValue({
          accountId: "account-1",
          status: "RESERVED",
          reservedCredits: 300,
          account: { creditDebt: 0 },
        }),
      },
      creditBucket: {
        findMany: vi.fn().mockResolvedValue([{ remaining: 3_000, reserved: 300 }]),
      },
    };

    await expect(getExecutionCreditBudget(database, { executionId: "execution-1", marginPercent: 20 })).resolves.toEqual({
      reservedCredits: 300,
      availableCredits: 3_000,
      marginPercent: 20,
      marginCredits: 600,
      hardLimitCredits: 3_600,
      previouslyConsumedCredits: 0,
    });
  });

  it("calcula para uma interação somente o saldo ainda disponível", async () => {
    const database = {
      executionCreditReservation: {
        findUnique: vi.fn().mockResolvedValue({
          accountId: "account-1",
          status: "SETTLED",
          reservedCredits: 300,
          consumedCredits: 120,
          account: { creditDebt: 0 },
        }),
      },
      creditBucket: { findMany: vi.fn().mockResolvedValue([{ remaining: 880, reserved: 0 }]) },
    };

    await expect(getExecutionCreditBudget(database, { executionId: "execution-1", marginPercent: 20 })).resolves.toEqual({
      reservedCredits: 300,
      availableCredits: 880,
      marginPercent: 20,
      marginCredits: 176,
      hardLimitCredits: 1_056,
      previouslyConsumedCredits: 120,
    });
  });

  it("consome o medido e devolve o restante da reserva", async () => {
    const transaction = {
      executionCreditReservation: {
        findUnique: vi.fn().mockResolvedValue({ id: "reservation-1", accountId: "account-1", status: "RESERVED", reservedCredits: 300, allocations: [{ bucketId: "bucket-1", credits: 100 }, { bucketId: "bucket-2", credits: 200 }] }),
        update: vi.fn().mockResolvedValue({ status: "SETTLED" }),
      },
      creditBucket: { update: vi.fn(), findMany: vi.fn() },
      creditTransaction: { create: vi.fn() },
      billingAccount: { update: vi.fn() },
    };

    await settleExecutionCredits(transaction, { executionId: "execution-1", consumedCredits: 120 });

    expect(transaction.creditBucket.update).toHaveBeenNthCalledWith(1, { where: { id: "bucket-1" }, data: { reserved: { decrement: 100 }, remaining: { decrement: 100 } } });
    expect(transaction.creditBucket.update).toHaveBeenNthCalledWith(2, { where: { id: "bucket-2" }, data: { reserved: { decrement: 200 }, remaining: { decrement: 20 } } });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CONSUME", amount: -120 }) });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "RELEASE", amount: 180 }) });
    expect(transaction.executionCreditReservation.update).toHaveBeenCalledWith({ where: { id: "reservation-1" }, data: expect.objectContaining({ status: "SETTLED", consumedCredits: 120, uncoveredCredits: 0 }) });
  });

  it("consome além da reserva quando existe saldo disponível no plano", async () => {
    const transaction = {
      executionCreditReservation: {
        findUnique: vi.fn().mockResolvedValue({ id: "reservation-1", accountId: "account-1", status: "RESERVED", reservedCredits: 700, allocations: [{ bucketId: "bucket-1", credits: 700 }] }),
        update: vi.fn().mockResolvedValue({ status: "SETTLED" }),
      },
      creditBucket: {
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: "bucket-2", remaining: 2_300, reserved: 0 }]),
      },
      creditTransaction: { create: vi.fn() },
      billingAccount: { update: vi.fn() },
    };

    await settleExecutionCredits(transaction, { executionId: "execution-1", consumedCredits: 1_894 });

    expect(transaction.creditBucket.update).toHaveBeenCalledTimes(2);
    expect(transaction.creditBucket.update).toHaveBeenNthCalledWith(1, {
      where: { id: "bucket-1" },
      data: { reserved: { decrement: 700 }, remaining: { decrement: 700 } },
    });
    expect(transaction.creditBucket.update).toHaveBeenNthCalledWith(2, {
      where: { id: "bucket-2" },
      data: { remaining: { decrement: 1_194 } },
    });
    expect(transaction.billingAccount.update).not.toHaveBeenCalled();
    expect(transaction.executionCreditReservation.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: expect.objectContaining({ consumedCredits: 1_894, uncoveredCredits: 0 }),
    });
  });

  it("registra como dívida somente a margem consumida além do saldo real", async () => {
    const transaction = {
      executionCreditReservation: {
        findUnique: vi.fn().mockResolvedValue({ id: "reservation-1", accountId: "account-1", status: "RESERVED", reservedCredits: 300, allocations: [{ bucketId: "bucket-1", credits: 300 }] }),
        update: vi.fn().mockResolvedValue({ status: "SETTLED" }),
      },
      creditBucket: {
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: "bucket-2", remaining: 700, reserved: 0 }]),
      },
      creditTransaction: { create: vi.fn() },
      billingAccount: { update: vi.fn() },
    };

    await settleExecutionCredits(transaction, { executionId: "execution-1", consumedCredits: 1_100 });

    expect(transaction.billingAccount.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: { creditDebt: { increment: 100 } },
    });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "CONSUME", amount: -1_100, metadata: expect.objectContaining({ consumedFromBuckets: 1_000, debtCredits: 100 }) }),
    });
    expect(transaction.executionCreditReservation.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: expect.objectContaining({ consumedCredits: 1_100, uncoveredCredits: 100 }),
    });
  });

  it("cobra somente o aumento de consumo após uma interação", async () => {
    const transaction = {
      executionCreditReservation: {
        findUnique: vi.fn().mockResolvedValue({ id: "reservation-1", accountId: "account-1", status: "SETTLED", reservedCredits: 300, consumedCredits: 120, uncoveredCredits: 0, allocations: [] }),
        update: vi.fn().mockResolvedValue({ status: "SETTLED" }),
      },
      creditBucket: {
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: "bucket-2", remaining: 500, reserved: 0 }]),
      },
      creditTransaction: { create: vi.fn() },
      billingAccount: { update: vi.fn() },
    };

    await settleExecutionCredits(transaction, { executionId: "execution-1", consumedCredits: 165 });

    expect(transaction.creditBucket.update).toHaveBeenCalledWith({ where: { id: "bucket-2" }, data: { remaining: { decrement: 45 } } });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        executionId: "execution-1",
        amount: -45,
        description: "Consumo medido da interação",
        metadata: expect.objectContaining({ previousConsumedCredits: 120, cumulativeConsumedCredits: 165 }),
      }),
    });
    expect(transaction.executionCreditReservation.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: expect.objectContaining({ consumedCredits: 165, uncoveredCredits: 0 }),
    });
  });
});
