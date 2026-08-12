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

export async function recoverStaleExecutions(database = db) {
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  const staleExecutions = await database.execution.findMany({
    where: {
      status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
      lockedAt: { lt: staleBefore },
    },
    select: { id: true, demandId: true, attempts: true, cancelRequestedAt: true },
  });

  for (const execution of staleExecutions) {
    const cancelled = Boolean(execution.cancelRequestedAt);
    const retrying = !cancelled && execution.attempts < 3;
    const executionData = cancelled
      ? { status: "CANCELLED", lockedAt: null, lockedBy: null, finishedAt: new Date() }
      : retrying
        ? { status: "QUEUED", lockedAt: null, lockedBy: null }
        : { status: "FAILED", lockedAt: null, lockedBy: null, error: "Execução interrompida após três tentativas", finishedAt: new Date() };
    const demandStatus = cancelled ? "APPROVED" : retrying ? "QUEUED" : "FAILED";

    await database.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: {
          id: execution.id,
          status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
          lockedAt: { lt: staleBefore },
          ...(cancelled ? { cancelRequestedAt: { not: null } } : { cancelRequestedAt: null }),
        },
        data: executionData,
      });
      if (updated.count === 1) {
        await transaction.demand.update({ where: { id: execution.demandId }, data: { status: demandStatus } });
      }
    });
  }
}
