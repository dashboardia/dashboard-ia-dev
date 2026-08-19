import { settleExecutionCredits } from "./billing.js";

const IMMEDIATE_STOP_STATUSES = ["QUEUED"];
const COOPERATIVE_STOP_STATUSES = ["PREPARING", "RUNNING", "VALIDATING"];

export class PlatformProcessingDisabledError extends Error {
  constructor() {
    super("Os processamentos estão temporariamente pausados pelo administrador da plataforma.");
    this.name = "PlatformProcessingDisabledError";
    this.status = 503;
    this.code = "PROCESSING_DISABLED";
  }
}

export async function assertPlatformProcessingEnabled(database) {
  const settings = await database.globalSettings.findUnique({ where: { id: "global" }, select: { executionProcessingEnabled: true } });
  if (settings?.executionProcessingEnabled === false) throw new PlatformProcessingDisabledError();
}

export async function stopPlatformExecutions(transaction, now = new Date()) {
  const affected = await transaction.execution.findMany({
    where: { status: { in: [...IMMEDIATE_STOP_STATUSES, ...COOPERATIVE_STOP_STATUSES] } },
    select: { id: true, demandId: true, status: true },
  });
  const immediate = affected.filter((execution) => IMMEDIATE_STOP_STATUSES.includes(execution.status));
  const cooperative = affected.filter((execution) => COOPERATIVE_STOP_STATUSES.includes(execution.status));

  if (immediate.length) {
    await transaction.execution.updateMany({
      where: { id: { in: immediate.map((execution) => execution.id) }, status: { in: IMMEDIATE_STOP_STATUSES } },
      data: { status: "STOPPED", stopRequestedAt: now, lockedAt: null, lockedBy: null, finishedAt: now },
    });
    for (const execution of immediate) await settleExecutionCredits(transaction, { executionId: execution.id, consumedCredits: 0 });
  }
  if (cooperative.length) {
    await transaction.execution.updateMany({
      where: { id: { in: cooperative.map((execution) => execution.id) }, status: { in: COOPERATIVE_STOP_STATUSES } },
      data: { stopRequestedAt: now },
    });
  }

  const demandIds = [...new Set(affected.map((execution) => execution.demandId))];
  if (demandIds.length) await transaction.demand.updateMany({ where: { id: { in: demandIds } }, data: { status: "STOPPED" } });
  return { immediate: immediate.length, cooperative: cooperative.length };
}
