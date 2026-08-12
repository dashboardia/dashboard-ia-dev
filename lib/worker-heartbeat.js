import { db } from "./db.js";

const HEARTBEAT_STALE_MS = 90_000;
const HEARTBEAT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function activeWorkerCutoff(now = new Date()) {
  return new Date(now.getTime() - HEARTBEAT_STALE_MS);
}

export function recordWorkerHeartbeat({ workerId, host, processId, startedAt }, client = db, now = new Date()) {
  return client.workerHeartbeat.upsert({
    where: { id: workerId },
    create: { id: workerId, host, processId, startedAt, lastSeenAt: now },
    update: { host, processId, lastSeenAt: now },
  });
}

export function removeWorkerHeartbeat(workerId, client = db) {
  return client.workerHeartbeat.deleteMany({ where: { id: workerId } });
}

export function pruneWorkerHeartbeats(client = db, now = new Date()) {
  return client.workerHeartbeat.deleteMany({
    where: { lastSeenAt: { lt: new Date(now.getTime() - HEARTBEAT_RETENTION_MS) } },
  });
}

export async function getWorkerRuntimeStatus({ client = db, now = new Date() } = {}) {
  const cutoff = activeWorkerCutoff(now);
  const [instances, latest] = await Promise.all([
    client.workerHeartbeat.count({ where: { lastSeenAt: { gte: cutoff } } }),
    client.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
  ]);
  return { online: instances > 0, instances, lastSeenAt: latest?.lastSeenAt ?? null };
}
