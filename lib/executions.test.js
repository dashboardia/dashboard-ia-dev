import { describe, expect, it, vi } from "vitest";

import { claimNextExecution, clientInteractionRequeueData, createQueuedDemandExecution, queueDemandExecution, recoverStaleExecutions, reopenFailedExecutionForCorrection, requeueFailedExecutionData } from "./executions";

function transactionDatabase(transaction, failures = []) {
  const transactionMock = vi.fn(async (callback, options) => {
    const failure = failures.shift();
    if (failure) throw failure;
    return callback(transaction, options);
  });
  return { $transaction: transactionMock };
}

describe("execution queue", () => {
  it("concede um novo orçamento de tentativas ao ajuste solicitado pelo cliente", () => {
    const now = new Date("2026-08-20T23:30:00.000Z");

    expect(clientInteractionRequeueData({ now, timeoutMinutes: 120 })).toEqual({
      status: "QUEUED",
      stage: "IMPLEMENTATION",
      adjustmentCount: { increment: 1 },
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      finishedAt: null,
      lastInteractionAt: now,
      conversationExpiresAt: new Date("2026-08-21T23:30:00.000Z"),
      error: null,
    });
  });

  it("reprocessa a mesma execução após uma falha sem consumir um novo ajuste", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    expect(requeueFailedExecutionData({ now, timeoutMinutes: 30 })).toEqual({
      status: "QUEUED",
      stage: "IMPLEMENTATION",
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      finishedAt: null,
      lastInteractionAt: now,
      conversationExpiresAt: new Date("2026-08-23T12:00:00.000Z"),
      error: null,
    });
  });

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

    await expect(queueDemandExecution({ demand: { id: "demand-1", aiModel: "gpt-5.6-luna" }, requestedById: "user-1" }, database)).resolves.toEqual({
      activeExecutionId: null,
      execution,
    });
    expect(database.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(transaction.execution.findFirst).toHaveBeenCalledWith({
      where: {
        demandId: "demand-1",
        status: { in: ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL", "AWAITING_CLIENT"] },
        cancelRequestedAt: null,
      },
      select: { id: true },
    });
    expect(transaction.execution.create).toHaveBeenCalledWith({
      data: {
        demandId: "demand-1",
        requestedById: "user-1",
        status: "QUEUED",
        stage: "ANALYSIS",
        model: "gpt-5.6-luna",
        allowEmptyRepository: false,
      },
    });
    expect(transaction.demand.update).toHaveBeenCalledWith({ where: { id: "demand-1" }, data: { status: "QUEUED" } });
  });

  it("registra quando o cliente confirmou a criação do projeto do zero", async () => {
    const transaction = {
      execution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "execution-empty" }),
      },
      demand: { update: vi.fn().mockResolvedValue({}) },
    };
    const database = transactionDatabase(transaction);

    await queueDemandExecution({
      demand: { id: "demand-empty", aiModel: "gpt-5.6-terra" },
      requestedById: "user-1",
      allowEmptyRepository: true,
    }, database);

    expect(transaction.execution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ allowEmptyRepository: true }),
    });
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

  it("cria a demanda e a execução juntas, já prontas para o worker", async () => {
    const demand = { id: "demand-auto", aiModel: "gpt-5.6-luna", project: { id: "project-1" } };
    const execution = { id: "execution-auto", status: "QUEUED" };
    const transaction = {
      demand: { create: vi.fn().mockResolvedValue(demand) },
      execution: { create: vi.fn().mockResolvedValue(execution) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = transactionDatabase(transaction);
    const demandData = { projectId: "project-1", title: "Nova tela", aiModel: "gpt-5.6-luna" };

    await expect(createQueuedDemandExecution({
      demandData,
      requestedById: "user-1",
      allowEmptyRepository: true,
      auditFactory: ({ demand: created, execution: queued }) => [
        { action: "demand.create", entityId: created.id },
        { action: "execution.queue", entityId: queued.id },
      ],
    }, database)).resolves.toEqual({ demand, execution });

    expect(transaction.demand.create).toHaveBeenCalledWith({
      data: { ...demandData, status: "QUEUED" },
      include: { project: { select: { id: true, name: true, slug: true } } },
    });
    expect(transaction.execution.create).toHaveBeenCalledWith({
      data: {
        demandId: demand.id,
        requestedById: "user-1",
        status: "QUEUED",
        stage: "ANALYSIS",
        model: demand.aiModel,
        allowEmptyRepository: true,
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(2);
    expect(database.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });
});

describe("failure recovery", () => {
  it("mantém a execução aberta para correção após uma falha", async () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const transaction = {
      execution: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      demand: { update: vi.fn().mockResolvedValue({}) },
      executionMessage: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      execution: { findUnique: vi.fn().mockResolvedValue({ id: "execution-1", demandId: "demand-1", status: "FAILED", closedAt: null }) },
      $transaction: vi.fn((callback) => callback(transaction)),
    };

    await expect(reopenFailedExecutionForCorrection("execution-1", database, { now, timeoutMinutes: 60 })).resolves.toBe(true);
    expect(transaction.execution.updateMany).toHaveBeenCalledWith({
      where: { id: "execution-1", status: "FAILED", closedAt: null },
      data: expect.objectContaining({ status: "AWAITING_CLIENT", finishedAt: now, conversationExpiresAt: new Date("2026-08-23T12:00:00.000Z") }),
    });
    expect(transaction.demand.update).toHaveBeenCalledWith({ where: { id: "demand-1" }, data: { status: "REVIEW" } });
    expect(transaction.executionMessage.create).toHaveBeenCalledTimes(1);
  });
});

describe("stale execution recovery", () => {
  it("sincroniza a demanda ao cancelar, repetir ou manter aberta uma execução interrompida", async () => {
    const staleExecutions = [
      { id: "stopped", demandId: "demand-stopped", attempts: 1, cancelRequestedAt: null, stopRequestedAt: new Date() },
      { id: "cancelled", demandId: "demand-cancelled", attempts: 1, cancelRequestedAt: new Date(), stopRequestedAt: null },
      { id: "retry", demandId: "demand-retry", attempts: 2, cancelRequestedAt: null, stopRequestedAt: null },
      { id: "failed", demandId: "demand-failed", attempts: 3, cancelRequestedAt: null, stopRequestedAt: null },
    ];
    const transaction = {
      execution: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      demand: { update: vi.fn().mockResolvedValue({}) },
      executionLog: { create: vi.fn().mockResolvedValue({}) },
      executionMessage: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      execution: { findMany: vi.fn().mockResolvedValue(staleExecutions) },
      $transaction: vi.fn((callback) => callback(transaction)),
    };

    await recoverStaleExecutions(database);

    expect(transaction.execution.updateMany.mock.calls.map(([input]) => input.data.status)).toEqual(["STOPPED", "CANCELLED", "QUEUED", "AWAITING_CLIENT"]);
    expect(transaction.demand.update.mock.calls.map(([input]) => input.data.status)).toEqual(["STOPPED", "APPROVED", "QUEUED", "REVIEW"]);
    expect(transaction.executionMessage.create).toHaveBeenCalledTimes(1);
    expect(database.$transaction).toHaveBeenCalledTimes(4);
  });

  it("não altera a demanda quando outra instância já recuperou a execução", async () => {
    const transaction = {
      execution: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      demand: { update: vi.fn() },
      executionLog: { create: vi.fn() },
      executionMessage: { create: vi.fn() },
    };
    const database = {
      execution: { findMany: vi.fn().mockResolvedValue([{ id: "stale", demandId: "demand-1", attempts: 1, cancelRequestedAt: null }]) },
      $transaction: vi.fn((callback) => callback(transaction)),
    };

    await recoverStaleExecutions(database);

    expect(transaction.demand.update).not.toHaveBeenCalled();
    expect(transaction.executionLog.create).not.toHaveBeenCalled();
  });

  it("recupera o lock de uma réplica que deixou de enviar heartbeat", async () => {
    const now = new Date("2026-08-20T21:30:00.000Z");
    const transaction = {
      execution: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      demand: { update: vi.fn().mockResolvedValue({}) },
      executionLog: { create: vi.fn().mockResolvedValue({}) },
      executionMessage: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      workerHeartbeat: { findMany: vi.fn().mockResolvedValue([{ id: "replica-new" }]) },
      execution: { findMany: vi.fn().mockResolvedValue([{ id: "orphan", demandId: "demand-1", attempts: 1, lockedBy: "replica-old", cancelRequestedAt: null, stopRequestedAt: null }]) },
      $transaction: vi.fn((callback) => callback(transaction)),
    };

    await recoverStaleExecutions(database, { staleMinutes: 30, maxAttempts: 3, now });

    expect(database.workerHeartbeat.findMany).toHaveBeenCalledWith({
      where: { lastSeenAt: { gte: new Date("2026-08-20T21:28:30.000Z") } },
      select: { id: true },
    });
    expect(database.execution.findMany.mock.calls[0][0].where.OR[0]).toEqual({
      lockedAt: { lt: new Date("2026-08-20T21:28:30.000Z") },
      lockedBy: { notIn: ["replica-new"] },
    });
    expect(transaction.execution.updateMany.mock.calls[0][0].data.status).toBe("QUEUED");
    expect(transaction.executionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ executionId: "orphan", level: "warn", metadata: { previousWorkerId: "replica-old", recovery: "orphaned-worker" } }),
    });
  });
});

describe("execution claim", () => {
  it("não reivindica trabalho enquanto o processamento global está pausado", async () => {
    const database = {
      globalSettings: { findUnique: vi.fn().mockResolvedValue({ executionProcessingEnabled: false, parallelExecutions: 2 }) },
      $queryRaw: vi.fn(),
    };
    await expect(claimNextExecution("worker-1", database, { maxAttempts: 5 })).resolves.toBeNull();
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it("reivindica atomicamente e prioriza clientes sem execução ativa", async () => {
    const database = { $queryRaw: vi.fn().mockResolvedValue([{ id: "execution-1" }]) };

    await expect(claimNextExecution("replica-1", database, {
      maxAttempts: 4,
      globalConcurrencyLimit: 3,
      processingEnabled: true,
    })).resolves.toBe("execution-1");

    const query = database.$queryRaw.mock.calls[0][0];
    const sql = query.strings.join("?");
    expect(sql).toContain("pg_try_advisory_xact_lock");
    expect(sql).toContain("activeByOwner");
    expect(sql).toContain("SKIP LOCKED");
    expect(query.values).toEqual([3, 4, "replica-1"]);
  });
});
