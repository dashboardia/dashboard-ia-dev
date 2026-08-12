import { Prisma } from "@prisma/client";

import { db } from "./db.js";

const ACTIVE_EXECUTION_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"];
const MAX_TRANSACTION_ATTEMPTS = 3;

function isTransactionConflict(error) {
  return error?.code === "P2034";
}

export async function queueDemandExecution({ demand, requestedById }, database = db) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        const active = await transaction.execution.findFirst({
          where: {
            demandId: demand.id,
            status: { in: ACTIVE_EXECUTION_STATUSES },
          },
          select: { id: true },
        });

        if (active) return { activeExecutionId: active.id, execution: null };

        const execution = await transaction.execution.create({
          data: {
            demandId: demand.id,
            requestedById,
            status: "QUEUED",
            stage: "ANALYSIS",
          },
        });
        await transaction.demand.update({ where: { id: demand.id }, data: { status: "QUEUED" } });
        return { activeExecutionId: null, execution };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 20));
    }
  }

  throw new Error("Não foi possível enfileirar a execução");
}

export async function claimNextExecution(workerId) {
  const candidate = await db.execution.findFirst({
    where: { status: "QUEUED", lockedAt: null, cancelRequestedAt: null, attempts: { lt: 3 } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await db.execution.updateMany({
    where: { id: candidate.id, status: "QUEUED", lockedAt: null, cancelRequestedAt: null },
    data: {
      status: "PREPARING",
      lockedAt: new Date(),
      lockedBy: workerId,
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });

  return claimed.count === 1 ? candidate.id : null;
}

export async function recoverStaleExecutions() {
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  await db.execution.updateMany({
    where: {
      status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
      cancelRequestedAt: { not: null },
      lockedAt: { lt: staleBefore },
    },
    data: { status: "CANCELLED", lockedAt: null, lockedBy: null, finishedAt: new Date() },
  });
  await db.execution.updateMany({
    where: {
      status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
      cancelRequestedAt: null,
      lockedAt: { lt: staleBefore },
      attempts: { lt: 3 },
    },
    data: { status: "QUEUED", lockedAt: null, lockedBy: null },
  });
  await db.execution.updateMany({
    where: {
      status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
      cancelRequestedAt: null,
      lockedAt: { lt: staleBefore },
      attempts: { gte: 3 },
    },
    data: { status: "FAILED", error: "Execução interrompida após três tentativas", finishedAt: new Date() },
  });
}
