import { describe, expect, it, vi } from "vitest";

import { queueDemandExecution, recoverStaleExecutions } from "./executions";

function transactionDatabase(transaction, failures = []) {
  const transactionMock = vi.fn(async (callback, options) => {
    const failure = failures.shift();
    if (failure) throw failure;
    return callback(transaction, options);
  });
  return { $transaction: transactionMock };
}

describe("execution queue", () => {
  it("cria uma única execução e atualiza a demanda na mesma transação serializável", async () => {
    const execution = { id: "execution-1", status: "QUEUED" };
    const transaction = {
      execution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(execution),
      },
      demand: { update: vi.fn().mockResolvedValue({ id: "demand-1" }) },
    };
    const database = transactionDatabase(transaction);

    await expect(queueDemandExecution({ demand: { id: "demand-1" }, requestedById: "user-1" }, database)).resolves.toEqual({
      activeExecutionId: null,
      execution,
    });
    expect(database.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(transaction.execution.findFirst).toHaveBeenCalledWith({
      where: {
        demandId: "demand-1",
        status: { in: ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"] },
        cancelRequestedAt: null,
      },
      select: { id: true },
    });
    expect(transaction.demand.update).toHaveBeenCalledWith({ where: { id: "demand-1" }, data: { status: "QUEUED" } });
  });

  it("repete a transação após conflito e retorna a execução que venceu a corrida", async () => {
    const transaction = {
      execution: {
        findFirst: vi.fn().mockResolvedValue({ id: "execution-existing" }),
        create: vi.fn(),
      },
      demand: { update: vi.fn() },
    };
    const database = transactionDatabase(transaction, [{ code: "P2034" }]);

    await expect(queueDemandExecution({ demand: { id: "demand-1" }, requestedById: "user-1" }, database)).resolves.toEqual({
      activeExecutionId: "execution-existing",
      execution: null,
    });
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.execution.create).not.toHaveBeenCalled();
  });

  it("não repete falhas que não são conflitos de transação", async () => {
    const failure = new Error("banco indisponível");
    const database = transactionDatabase({}, [failure]);

    await expect(queueDemandExecution({ demand: { id: "demand-1" }, requestedById: "user-1" }, database)).rejects.toBe(failure);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("stale execution recovery", () => {
  it("sincroniza a demanda ao cancelar, repetir ou encerrar execuções interrompidas", async () => {
    const staleExecutions = [
      { id: "cancelled", demandId: "demand-cancelled", attempts: 1, cancelRequestedAt: new Date() },
      { id: "retry", demandId: "demand-retry", attempts: 2, cancelRequestedAt: null },
      { id: "failed", demandId: "demand-failed", attempts: 3, cancelRequestedAt: null },
    ];
    const transaction = {
      execution: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      demand: { update: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      execution: { findMany: vi.fn().mockResolvedValue(staleExecutions) },
      $transaction: vi.fn((callback) => callback(transaction)),
    };

    await recoverStaleExecutions(database);

    expect(transaction.execution.updateMany.mock.calls.map(([input]) => input.data.status)).toEqual(["CANCELLED", "QUEUED", "FAILED"]);
    expect(transaction.demand.update.mock.calls.map(([input]) => input.data.status)).toEqual(["APPROVED", "QUEUED", "FAILED"]);
    expect(database.$transaction).toHaveBeenCalledTimes(3);
  });

  it("não altera a demanda quando outra instância já recuperou a execução", async () => {
    const transaction = {
      execution: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      demand: { update: vi.fn() },
    };
    const database = {
      execution: { findMany: vi.fn().mockResolvedValue([{ id: "stale", demandId: "demand-1", attempts: 1, cancelRequestedAt: null }]) },
      $transaction: vi.fn((callback) => callback(transaction)),
    };

    await recoverStaleExecutions(database);

    expect(transaction.demand.update).not.toHaveBeenCalled();
  });
});
