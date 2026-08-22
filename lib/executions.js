import { Prisma } from "@prisma/client";

import { db } from "./db.js";
import { reserveExecutionCredits, settleExecutionCredits } from "./billing.js";
import { activeWorkerCutoff } from "./worker-heartbeat.js";

const ACTIVE_EXECUTION_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL", "AWAITING_CLIENT"];
const MAX_TRANSACTION_ATTEMPTS = 3;
const MINIMUM_CONVERSATION_TIMEOUT_MINUTES = 24 * 60;

function conversationDeadline(now, timeoutMinutes) {
  const safeTimeoutMinutes = Math.max(MINIMUM_CONVERSATION_TIMEOUT_MINUTES, Number(timeoutMinutes) || 0);
  return new Date(now.getTime() + safeTimeoutMinutes * 60_000);
}

export function clientInteractionRequeueData({ now = new Date(), timeoutMinutes }) {
  return {
    status: "QUEUED",
    stage: "IMPLEMENTATION",
    adjustmentCount: { increment: 1 },
    attempts: 0,
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    finishedAt: null,
    lastInteractionAt: now,
    conversationExpiresAt: conversationDeadline(now, timeoutMinutes),
    error: null,
  };
}

export function requeueFailedExecutionData({ now = new Date(), timeoutMinutes }) {
  return {
    status: "QUEUED",
    stage: "IMPLEMENTATION",
    attempts: 0,
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    finishedAt: null,
    lastInteractionAt: now,
    conversationExpiresAt: conversationDeadline(now, timeoutMinutes),
    error: null,
  };
}

export async function reopenFailedExecutionForCorrection(executionId, database = db, { now = new Date(), timeoutMinutes = MINIMUM_CONVERSATION_TIMEOUT_MINUTES } = {}) {
  const current = await database.execution.findUnique({
    where: { id: executionId },
    select: { id: true, demandId: true, status: true, closedAt: true },
  });
  if (!current || current.status !== "FAILED" || current.closedAt) return false;

  return database.$transaction(async (transaction) => {
    const updated = await transaction.execution.updateMany({
      where: { id: executionId, status: "FAILED", closedAt: null },
      data: {
        status: "AWAITING_CLIENT",
        lockedAt: null,
        lockedBy: null,
        finishedAt: now,
        lastInteractionAt: now,
        conversationExpiresAt: conversationDeadline(now, timeoutMinutes),
      },
    });
    if (updated.count !== 1) return false;
    await transaction.demand.update({ where: { id: current.demandId }, data: { status: "REVIEW" } });
    await transaction.executionMessage.create({
      data: {
        executionId,
        role: "SYSTEM",
        content: "A execução encontrou uma falha e ficou aberta para correção. Use a opção Corrigir com IA para continuar nesta mesma execução; ela só será encerrada quando você concluir ou após o período de inatividade.",
      },
    });
    return true;
  });
}

function isTransactionConflict(error) {
  return error?.code === "P2034";
}

export async function queueDemandExecution({ demand, requestedById, billing = null, allowEmptyRepository = false }, database = db) {
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
            allowEmptyRepository: Boolean(allowEmptyRepository),
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

export async function claimNextExecution(workerId, database = db, options = {}) {
  const settings = options.processingEnabled == null || options.globalConcurrencyLimit == null
    ? await database.globalSettings.findUnique({
      where: { id: "global" },
      select: { executionProcessingEnabled: true, parallelExecutions: true },
    })
    : null;
  const processingEnabled = options.processingEnabled ?? settings?.executionProcessingEnabled ?? true;
  if (!processingEnabled) return null;

  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const globalConcurrencyLimit = Math.max(1, Math.trunc(options.globalConcurrencyLimit ?? settings?.parallelExecutions ?? 1));
  const claimed = await database.$queryRaw(Prisma.sql`
    WITH "claimGate" AS (
      SELECT pg_try_advisory_xact_lock(731245987) AS "acquired"
    ),
    "capacity" AS (
      SELECT COUNT(*)::integer AS "activeCount"
      FROM "Execution"
      WHERE "status" IN ('PREPARING'::"ExecutionStatus", 'RUNNING'::"ExecutionStatus", 'VALIDATING'::"ExecutionStatus")
        AND "lockedAt" IS NOT NULL
    ),
    "activeByOwner" AS (
      SELECT active_project."createdById" AS "ownerUserId", COUNT(*)::integer AS "activeCount"
      FROM "Execution" active_execution
      INNER JOIN "Demand" active_demand ON active_demand."id" = active_execution."demandId"
      INNER JOIN "Project" active_project ON active_project."id" = active_demand."projectId"
      WHERE active_execution."status" IN ('PREPARING'::"ExecutionStatus", 'RUNNING'::"ExecutionStatus", 'VALIDATING'::"ExecutionStatus")
        AND active_execution."lockedAt" IS NOT NULL
      GROUP BY active_project."createdById"
    ),
    "candidate" AS (
      SELECT queued_execution."id"
      FROM "Execution" queued_execution
      INNER JOIN "Demand" queued_demand ON queued_demand."id" = queued_execution."demandId"
      INNER JOIN "Project" queued_project ON queued_project."id" = queued_demand."projectId"
      LEFT JOIN "activeByOwner" owner_activity ON owner_activity."ownerUserId" = queued_project."createdById"
      CROSS JOIN "claimGate"
      CROSS JOIN "capacity"
      WHERE "claimGate"."acquired"
        AND "capacity"."activeCount" < ${globalConcurrencyLimit}
        AND queued_execution."status" = 'QUEUED'::"ExecutionStatus"
        AND queued_execution."lockedAt" IS NULL
        AND queued_execution."cancelRequestedAt" IS NULL
        AND queued_execution."stopRequestedAt" IS NULL
        AND queued_execution."attempts" < ${maxAttempts}
      ORDER BY COALESCE(owner_activity."activeCount", 0) ASC, queued_execution."createdAt" ASC
      FOR UPDATE OF queued_execution SKIP LOCKED
      LIMIT 1
    )
    UPDATE "Execution" execution
    SET "status" = 'PREPARING'::"ExecutionStatus",
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        "attempts" = execution."attempts" + 1,
        "startedAt" = COALESCE(execution."startedAt", NOW())
    FROM "candidate"
    WHERE execution."id" = "candidate"."id"
    RETURNING execution."id"
  `);

  return claimed[0]?.id ?? null;
}

export async function recoverStaleExecutions(database = db, { staleMinutes = 30, maxAttempts = 3, now = new Date() } = {}) {
  const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const orphanBefore = activeWorkerCutoff(now);
  const activeWorkers = database.workerHeartbeat?.findMany
    ? await database.workerHeartbeat.findMany({
      where: { lastSeenAt: { gte: orphanBefore } },
      select: { id: true },
    })
    : null;
  const activeWorkerIds = activeWorkers?.map((worker) => worker.id) ?? [];
  const recoveryLeaseWhere = activeWorkerIds.length
    ? {
      OR: [
        { lockedAt: { lt: orphanBefore }, lockedBy: { notIn: activeWorkerIds } },
        { lockedAt: { lt: staleBefore }, lockedBy: null },
      ],
    }
    : { lockedAt: { lt: staleBefore } };
  const staleExecutions = await database.execution.findMany({
    where: {
      status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
      ...recoveryLeaseWhere,
    },
    select: { id: true, demandId: true, attempts: true, lockedBy: true, cancelRequestedAt: true, stopRequestedAt: true },
  });

  for (const execution of staleExecutions) {
    const stopped = Boolean(execution.stopRequestedAt);
    const cancelled = Boolean(execution.cancelRequestedAt);
    const retrying = !stopped && !cancelled && execution.attempts < maxAttempts;
    const waitingForCorrection = !stopped && !cancelled && !retrying;
    const executionData = stopped
      ? { status: "STOPPED", lockedAt: null, lockedBy: null, finishedAt: now }
      : cancelled
      ? { status: "CANCELLED", lockedAt: null, lockedBy: null, finishedAt: now }
      : retrying
        ? { status: "QUEUED", lockedAt: null, lockedBy: null }
        : {
            status: "AWAITING_CLIENT",
            lockedAt: null,
            lockedBy: null,
            error: "Execução interrompida após três tentativas",
            finishedAt: now,
            lastInteractionAt: now,
            conversationExpiresAt: conversationDeadline(now, MINIMUM_CONVERSATION_TIMEOUT_MINUTES),
          };
    const demandStatus = stopped ? "STOPPED" : cancelled ? "APPROVED" : retrying ? "QUEUED" : "REVIEW";

    await database.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: {
          id: execution.id,
          status: { in: ["PREPARING", "RUNNING", "VALIDATING"] },
          ...recoveryLeaseWhere,
          ...(stopped ? { stopRequestedAt: { not: null } } : cancelled ? { cancelRequestedAt: { not: null } } : { cancelRequestedAt: null, stopRequestedAt: null }),
        },
        data: executionData,
      });
      if (updated.count === 1) {
        if (!retrying) await settleExecutionCredits(transaction, { executionId: execution.id, consumedCredits: 0 });
        await transaction.demand.update({ where: { id: execution.demandId }, data: { status: demandStatus } });
        if (waitingForCorrection) {
          await transaction.executionMessage.create({
            data: { executionId: execution.id, role: "SYSTEM", content: "A execução foi interrompida repetidamente e ficou aberta para correção. Revise os detalhes e use Corrigir com IA para continuar." },
          });
        }
        await transaction.executionLog.create({
          data: {
            executionId: execution.id,
            scope: "worker",
            level: "warn",
            message: retrying
              ? "O processamento anterior foi interrompido; a execução retornou automaticamente à fila."
              : waitingForCorrection
                ? "O processamento anterior foi interrompido e a execução ficou aberta para correção."
                : stopped
                  ? "Execução interrompida pela pausa global da plataforma."
                  : "Execução cancelada.",
            metadata: { previousWorkerId: execution.lockedBy ?? null, recovery: "orphaned-worker" },
          },
        });
      }
    });
  }
}

export async function expireInactiveExecutionConversations(database = db, now = new Date()) {
  const inactivityCutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const expired = await database.execution.findMany({
    where: { status: "AWAITING_CLIENT", conversationExpiresAt: { lte: now }, lastInteractionAt: { lte: inactivityCutoff }, closedAt: null },
    select: { id: true, demandId: true },
  });
  for (const execution of expired) {
    await database.$transaction(async (transaction) => {
      const updated = await transaction.execution.updateMany({
        where: { id: execution.id, status: "AWAITING_CLIENT", conversationExpiresAt: { lte: now }, lastInteractionAt: { lte: inactivityCutoff }, closedAt: null },
        data: { status: "SUCCEEDED", closedAt: now, closedReason: "INACTIVITY", finishedAt: now },
      });
      if (updated.count !== 1) return;
      await transaction.executionMessage.create({ data: { executionId: execution.id, role: "SYSTEM", content: "Execução encerrada automaticamente por inatividade." } });
      await transaction.demand.update({ where: { id: execution.demandId }, data: { status: "SUCCEEDED" } });
    });
  }
  return expired.length;
}
