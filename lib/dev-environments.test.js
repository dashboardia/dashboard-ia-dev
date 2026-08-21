import { describe, expect, it, vi } from "vitest";

import { chargeReadyDevEnvironment, refundFailedDevEnvironment } from "./dev-environments.js";

function failedEnvironment() {
  return {
    id: "environment-1",
    creditRefundedAt: null,
    creditCharge: {
      bypass: false,
      credits: 300,
      accountId: "account-1",
      allocations: [{ bucketId: "bucket-1", credits: 300 }],
    },
  };
}

function readyEnvironment() {
  return {
    id: "environment-2",
    branchName: "main",
    status: "READY",
    creditChargedAt: null,
    creditCharge: {
      bypass: false,
      status: "RESERVED",
      credits: 30,
      accountId: "account-1",
      allocations: [{ bucketId: "bucket-1", credits: 30 }],
    },
  };
}

describe("dev environment billing", () => {
  it("estorna uma falha exatamente uma vez", async () => {
    const transaction = {
      devEnvironment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      creditBucket: { update: vi.fn().mockResolvedValue({}) },
      creditTransaction: { create: vi.fn().mockResolvedValue({ id: "refund-1" }) },
    };
    const database = { $transaction: vi.fn((operation) => operation(transaction)) };

    await expect(refundFailedDevEnvironment(database, failedEnvironment())).resolves.toBe(true);
    expect(transaction.creditBucket.update).toHaveBeenCalledWith({
      where: { id: "bucket-1" },
      data: { remaining: { increment: 300 } },
    });
    expect(transaction.creditTransaction.create).toHaveBeenCalledOnce();
  });

  it("libera a proteção sem consumir saldo quando a publicação falha", async () => {
    const transaction = {
      devEnvironment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      creditBucket: { update: vi.fn().mockResolvedValue({}) },
      creditTransaction: { create: vi.fn().mockResolvedValue({ id: "release-1" }) },
    };
    const database = { $transaction: vi.fn((operation) => operation(transaction)) };
    const environment = readyEnvironment();
    environment.status = "FAILED";

    await expect(refundFailedDevEnvironment(database, environment)).resolves.toBe(true);
    expect(transaction.creditBucket.update).toHaveBeenCalledWith({
      where: { id: "bucket-1" },
      data: { reserved: { decrement: 30 } },
    });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "RELEASE", amount: 30 }) }));
  });

  it("não estorna um ambiente que já ficou disponível e foi cobrado", async () => {
    const database = { $transaction: vi.fn() };
    const environment = { ...readyEnvironment(), status: "FAILED", creditChargedAt: new Date(), creditCharge: { ...readyEnvironment().creditCharge, status: "CHARGED" } };

    await expect(refundFailedDevEnvironment(database, environment)).resolves.toBe(false);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("não duplica o estorno quando outra sincronização já conciliou a falha", async () => {
    const transaction = {
      devEnvironment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      creditBucket: { update: vi.fn() },
      creditTransaction: { create: vi.fn() },
    };
    const database = { $transaction: vi.fn((operation) => operation(transaction)) };

    await expect(refundFailedDevEnvironment(database, failedEnvironment())).resolves.toBe(false);
    expect(transaction.creditBucket.update).not.toHaveBeenCalled();
    expect(transaction.creditTransaction.create).not.toHaveBeenCalled();
  });
});

describe("successful dev environment billing", () => {
  it("cobra a reserva somente quando o ambiente fica pronto", async () => {
    const transaction = {
      devEnvironment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}) },
      creditBucket: { update: vi.fn().mockResolvedValue({}) },
      creditTransaction: { create: vi.fn().mockResolvedValue({ id: "charge-1" }) },
    };
    const database = { $transaction: vi.fn((operation) => operation(transaction)) };

    await expect(chargeReadyDevEnvironment(database, readyEnvironment())).resolves.toBe(true);
    expect(transaction.creditBucket.update).toHaveBeenCalledWith({
      where: { id: "bucket-1" },
      data: { reserved: { decrement: 30 }, remaining: { decrement: 30 } },
    });
    expect(transaction.creditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "CONSUME", amount: -30 }) }));
  });
});
