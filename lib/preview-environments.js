const ACTIVE_PREVIEW_STATES = new Set(["QUEUED", "BUILDING", "DEPLOYING", "READY", "STOPPING"]);

const ALLOWED_TRANSITIONS = {
  QUEUED: new Set(["BUILDING", "FAILED", "STOPPING", "EXPIRED"]),
  BUILDING: new Set(["DEPLOYING", "FAILED", "STOPPING", "EXPIRED"]),
  DEPLOYING: new Set(["READY", "FAILED", "STOPPING", "EXPIRED"]),
  READY: new Set(["FAILED", "STOPPING", "EXPIRED"]),
  FAILED: new Set(["QUEUED", "EXPIRED"]),
  STOPPING: new Set(["EXPIRED", "FAILED"]),
  EXPIRED: new Set(["QUEUED"]),
};

export const DEFAULT_PREVIEW_TTL_MINUTES = 60;

export function previewExpirationDate(now = new Date(), ttlMinutes = DEFAULT_PREVIEW_TTL_MINUTES) {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 24 * 60) {
    throw new Error("O tempo de vida do preview deve ficar entre 5 minutos e 24 horas");
  }
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export function assertPreviewTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw new Error(`Transição inválida do preview: ${currentStatus} → ${nextStatus}`);
  }
}

export function isPreviewEnvironmentActive(status) {
  return ACTIVE_PREVIEW_STATES.has(status);
}

export async function queuePreviewEnvironment(database, { executionId, ttlMinutes = DEFAULT_PREVIEW_TTL_MINUTES, now = new Date() }) {
  const expiresAt = previewExpirationDate(now, ttlMinutes);
  return database.previewEnvironment.upsert({
    where: { executionId },
    create: { executionId, expiresAt },
    update: {
      status: "QUEUED",
      provider: "DASHBOARDIA",
      externalId: null,
      url: null,
      runtime: null,
      imageReference: null,
      port: null,
      error: null,
      requestedAt: now,
      startedAt: null,
      readyAt: null,
      expiresAt,
      stoppedAt: null,
      lastHeartbeatAt: null,
    },
  });
}

export async function transitionPreviewEnvironment(database, id, nextStatus, data = {}) {
  return database.$transaction(async (transaction) => {
    const current = await transaction.previewEnvironment.findUniqueOrThrow({ where: { id } });
    assertPreviewTransition(current.status, nextStatus);
    const now = new Date();
    const timestamps = {
      ...(nextStatus === "BUILDING" && !current.startedAt ? { startedAt: now } : {}),
      ...(nextStatus === "READY" ? { readyAt: now, lastHeartbeatAt: now } : {}),
      ...(nextStatus === "EXPIRED" ? { stoppedAt: now, url: null } : {}),
    };
    return transaction.previewEnvironment.update({
      where: { id },
      data: { ...data, ...timestamps, status: nextStatus },
    });
  });
}
