import { refundFixedCreditsInTransaction, settleFixedCreditsInTransaction } from "./billing.js";
import { deleteDashboardiaPreview, getDashboardiaPreview } from "./preview-host-client.js";

export const ACTIVE_ENVIRONMENT_STATUSES = ["QUEUED", "BUILDING", "DEPLOYING", "READY", "STOPPING"];

export function environmentExpirationDate(ttlMinutes, now = new Date()) {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export async function refundFailedDevEnvironment(database, environment, now = new Date()) {
  const chargedCredits = Number(environment?.creditCharge?.credits ?? 0);
  if (!environment || environment.creditChargedAt || environment.creditRefundedAt || chargedCredits <= 0) return false;
  return database.$transaction(async (transaction) => {
    const claimed = await transaction.devEnvironment.updateMany({ where: { id: environment.id, creditRefundedAt: null }, data: { creditRefundedAt: now } });
    if (claimed.count !== 1) return false;
    await refundFixedCreditsInTransaction(transaction, environment.creditCharge, `Estorno automático: ambiente ${environment.id} falhou durante a publicação`);
    return true;
  });
}

export async function chargeReadyDevEnvironment(database, environment, now = new Date()) {
  const reservation = environment?.creditCharge;
  if (!environment || environment.creditChargedAt || reservation?.status !== "RESERVED") return false;
  return database.$transaction(async (transaction) => {
    const claimed = await transaction.devEnvironment.updateMany({ where: { id: environment.id, status: "READY", creditChargedAt: null }, data: { creditChargedAt: now } });
    if (claimed.count !== 1) return false;
    const charge = await settleFixedCreditsInTransaction(transaction, reservation, `Ambiente publicado com sucesso · ${environment.branchName}`);
    await transaction.devEnvironment.update({ where: { id: environment.id }, data: { creditCharge: charge } });
    return true;
  });
}

function synchronizedRuntime(environment, remote) {
  if (["RAILPACK", "UNKNOWN"].includes(remote.runtime)) return environment.runtime;
  return remote.runtime ?? environment.runtime;
}

export async function syncDevEnvironment(database, environment) {
  if (!environment || !ACTIVE_ENVIRONMENT_STATUSES.includes(environment.status) || !environment.externalId) return environment;
  const remote = await getDashboardiaPreview(environment.externalId);
  const now = new Date();
  const data = {
    status: remote.status,
    url: remote.status === "READY" ? remote.url : environment.url,
    runtime: synchronizedRuntime(environment, remote),
    imageReference: remote.imageReference ?? environment.imageReference,
    port: remote.port ?? environment.port,
    error: remote.error ?? null,
    adjustments: Array.isArray(remote.adjustments) ? remote.adjustments : environment.adjustments,
    credentials: Object.hasOwn(remote, "credentials") ? remote.credentials : environment.credentials,
    activity: Array.isArray(remote.activity) ? remote.activity : environment.activity,
    lastHeartbeatAt: now,
    ...(["BUILDING", "DEPLOYING"].includes(remote.status) && !environment.startedAt ? { startedAt: now } : {}),
    ...(remote.status === "READY" && !environment.readyAt ? { readyAt: now } : {}),
    ...(remote.status === "EXPIRED" ? { stoppedAt: now, url: null, credentials: null } : {}),
  };
  const updated = await database.devEnvironment.update({ where: { id: environment.id }, data });
  if (remote.status === "READY") {
    await chargeReadyDevEnvironment(database, updated, now);
    return database.devEnvironment.findUniqueOrThrow({ where: { id: environment.id } });
  }
  if (remote.status !== "FAILED") return updated;
  await refundFailedDevEnvironment(database, updated, now);
  return database.devEnvironment.findUniqueOrThrow({ where: { id: environment.id } });
}

export async function syncActiveDevEnvironments(database, limit = 50) {
  const [active, failed] = await Promise.all([
    database.devEnvironment.findMany({ where: { status: { in: ACTIVE_ENVIRONMENT_STATUSES }, externalId: { not: null } }, orderBy: { updatedAt: "asc" }, take: limit }),
    database.devEnvironment.findMany({ where: { status: "FAILED", externalId: { not: null }, creditRefundedAt: null, creditCharge: { path: ["credits"], gt: 0 } }, orderBy: { updatedAt: "asc" }, take: limit }),
  ]);
  return Promise.allSettled([
    ...active.map((environment) => syncDevEnvironment(database, environment)),
    ...failed.map((environment) => refundFailedDevEnvironment(database, environment)),
  ]);
}

export async function stopDevEnvironment(database, environment) {
  if (environment.externalId && !["FAILED", "EXPIRED"].includes(environment.status)) await deleteDashboardiaPreview(environment.externalId);
  const stopped = await database.devEnvironment.update({ where: { id: environment.id }, data: { status: "EXPIRED", url: null, credentials: null, stoppedAt: new Date(), lastHeartbeatAt: new Date() } });
  await refundFailedDevEnvironment(database, stopped);
  return database.devEnvironment.findUniqueOrThrow({ where: { id: environment.id } });
}
