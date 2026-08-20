import { Prisma } from "@prisma/client";

import { db } from "./db.js";
import { reserveExecutionCredits, settleExecutionCredits } from "./billing.js";

const ACTIVE_EXECUTION_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL", "AWAITING_CLIENT"];
const MAX_TRANSACTION_ATTEMPTS = 3;

function isTransactionConflict(error) {
  return error?.code === "P2034";
}

export async function queueDemandExecution({ demand, requestedById, billing = null }, database = db) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        const active = await transaction.execution.findFirst({
          where: {
            demandId: demand.id,
            status: { in: ACTIVE_EXECUTION_STATUSES },
            cancelRequestedAt: null,
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
            model: demand.aiModel,
          },
        });
        if (billing && !billing.bypass) {
          await reserveExecutionCredits(transaction, {
            accountId: billing.account.id,
            executionId: execution.id,
            credits: billing.reservationCredits,
            estimateMetadata: billing.reservationEstimate,
          });
        }
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

export async function claimNextExecution(workerId, database = db, maxAttempts = 3) {
  const settings = await database.globalSettings.findUnique({ where: { id: "global" }, select: { executionProcessingEnabled: true } });
  if (settings?.executionProcessingEnabled === false) return null;
  const candidate = await database.execution.findFirst({
    where: { status: "QUEUED", lockedAt: null, cancelRequestedAt: null, stopRequestedAt: null, attempts: { lt: maxAttempts } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await database.execution.updateMany({
    where: { id: candidate.id, status: "QUEUED", lockedAt: null, cancelRequestedAt: null, stopRequestedAt: null },
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

export async function recoverStaleExecutions(database = db, { staleMinutes = 30, maxAttempts = 3 } = {}) {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const staleExecutions = await database.execution.findMany({
    where: {
      status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
      lockedAt: { lt: staleBefore },
    },
    select: { id: true, demandId: true, attempts: true, cancelRequestedAt: true, stopRequestedAt: true },
  });

  for (const execution of staleExecutions) {
    const stopped = Boolean(execution.stopRequestedAt);
    const cancelled = Boolean(execution.cancelRequestedAt);
    const retrying = !stopped && !cancelled && execution.attempts < maxAttempts;
    const executionData = stopped
      ? { status: "STOPPED", lockedAt: null, lockedBy: null, finishedAt: new Date() }
      : cancelled
      ? { status: "CANCELLED", lockedAt: null, lockedBy: null, finishedAt: new Date() }
      : retrying
        ? { status: "QUEUED", lockedAt: null, lockedBy: null }
        : { status: "FAILED", lockedAt: null, lockedBy: null, error: "Execução interrompida após três tentativas", finishedAt: new Date() };
    const demandStatus = stopped ? "STOPPED" : cancelled ? "APPROVED" : retrying ? "QUEUED" : "FAILED";

    await database.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: {
          id: execution.id,
          status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
          lockedAt: { lt: staleBefore },
          ...(stopped ? { stopRequestedAt: { not: null } } : cancelled ? { cancelRequestedAt: { not: null } } : { cancelRequestedAt: null, stopRequestedAt: null }),
        },
        data: executionData,
      });
      if (updated.count === 1) {
        if (!retrying) await settleExecutionCredits(transaction, { executionId: execution.id, consumedCredits: 0 });
        await transaction.demand.update({ where: { id: execution.demandId }, data: { status: demandStatus } });
      }
    });
  }
}

export async function expireInactiveExecutionConversations(database = db, now = new Date()) {
  const expired = await database.execution.findMany({
    where: { status: "AWAITING_CLIENT", conversationExpiresAt: { lte: now }, closedAt: null },
    select: { id: true, demandId: true },
  });
  for (const execution of expired) {
    await database.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: { id: execution.id, status: "AWAITING_CLIENT", conversationExpiresAt: { lte: now }, closedAt: null },
        data: { status: "SUCCEEDED", closedAt: now, closedReason: "INACTIVITY", finishedAt: now },
      });
      if (updated.count !== 1) return;
      await transaction.executionMessage.create({ data: { executionId: execution.id, role: "SYSTEM", content: "Execução encerrada automaticamente por inatividade." } });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "SUCCEEDED" } });
    });
  }
  return expired.length;
}
