import { describe, expect, it, vi } from "vitest";

import { assertCanCreateProject, billingAccessIsActive, claimTrialOrganization, ensureBillingAccount, settleExecutionCredits } from "./billing";
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
});
