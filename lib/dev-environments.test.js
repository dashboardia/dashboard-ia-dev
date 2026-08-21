import { describe, expect, it, vi } from "vitest";

import { refundFailedDevEnvironment } from "./dev-environments.js";

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
