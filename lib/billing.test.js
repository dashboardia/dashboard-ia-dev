import { describe, expect, it, vi } from "vitest";

import { assertCanCreateProject, billingAccessIsActive, claimTrialOrganization, ensureBillingAccount, getExecutionCreditBudget, reconcileCurrentCycleCredits, settleExecutionCredits } from "./billing";
import { BILLING_PLANS, CREDIT_PACKS, executionReservationCredits } from "./billing-plans";

describe("billing plans", () => {
  it("preserva os preços, limites e créditos aprovados", () => {
    expect(BILLING_PLANS.TRIAL).toMatchObject({ includedCredits: 300, projectLimit: 1, parallelExecutionLimit: 1, trialDays: 7 });
    expect(BILLING_PLANS.STUDIO).toMatchObject({ priceCents: 29_700, includedCredits: 3_000, projectLimit: 5, parallelExecutionLimit: 2 });
    expect(BILLING_PLANS.AGENCY).toMatchObject({ priceCents: 69_700, includedCredits: 7_000, projectLimit: 20, parallelExecutionLimit: 5 });
    expect(CREDIT_PACKS.every((pack) => pack.priceCents === pack.credits * 10)).toBe(true);
  });

  it("reserva mais créditos para modelos de maior custo", () => {
    expect(executionReservationCredits("gpt-5.6-luna")).toBe(75);
    expect(executionReservationCredits("gpt-5.6-terra")).toBe(300);
    expect(executionReservationCredits("gpt-5.6-sol")).toBe(700);
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
      data: expect.objectContaining({ type: "CONSUME", amount: -1_100, metadata: { consumedFromBuckets: 1_000, debtCredits: 100 } }),
    });
    expect(transaction.executionCreditReservation.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: expect.objectContaining({ consumedCredits: 1_100, uncoveredCredits: 100 }),
    });
  });
});
