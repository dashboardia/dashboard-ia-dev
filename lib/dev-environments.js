import { deleteDashboardiaPreview, getDashboardiaPreview } from "./preview-host-client.js";

export const ACTIVE_ENVIRONMENT_STATUSES = ["QUEUED", "BUILDING", "DEPLOYING", "READY", "STOPPING"];

export function environmentExpirationDate(ttlMinutes, now = new Date()) {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export async function syncDevEnvironment(database, environment) {
  if (!environment || !ACTIVE_ENVIRONMENT_STATUSES.includes(environment.status) || !environment.externalId) return environment;
  const remote = await getDashboardiaPreview(environment.externalId);
  const now = new Date();
  return database.devEnvironment.update({
    where: { id: environment.id },
    data: {
      status: remote.status,
      url: remote.status === "READY" ? remote.url : environment.url,
      runtime: remote.runtime ?? environment.runtime,
      imageReference: remote.imageReference ?? environment.imageReference,
      port: remote.port ?? environment.port,
      error: remote.error ?? null,
      adjustments: Array.isArray(remote.adjustments) ? remote.adjustments : environment.adjustments,
      credentials: Object.hasOwn(remote, "credentials") ? remote.credentials : environment.credentials,
      lastHeartbeatAt: now,
      ...(["BUILDING", "DEPLOYING"].includes(remote.status) && !environment.startedAt ? { startedAt: now } : {}),
      ...(remote.status === "READY" && !environment.readyAt ? { readyAt: now } : {}),
      ...(remote.status === "EXPIRED" ? { stoppedAt: now, url: null, credentials: null } : {}),
    },
  });
}

export async function stopDevEnvironment(database, environment) {
  if (environment.externalId && !["FAILED", "EXPIRED"].includes(environment.status)) {
    await deleteDashboardiaPreview(environment.externalId);
  }
  return database.devEnvironment.update({
    where: { id: environment.id },
    data: { status: "EXPIRED", url: null, credentials: null, stoppedAt: new Date(), lastHeartbeatAt: new Date() },
  });
}
