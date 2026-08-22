import { deleteDashboardiaPreview } from "./preview-host-client.js";

const TERMINAL_PREVIEW_STATUSES = new Set(["EXPIRED"]);

export async function terminateExecutionPreview(database, executionId) {
  const preview = await database.previewEnvironment.findUnique({ where: { executionId } }).catch(() => null);
  if (!preview) return { stopped: false, previewId: null };

  if (!TERMINAL_PREVIEW_STATUSES.has(preview.status)) {
    await deleteDashboardiaPreview(preview.externalId ?? preview.id).catch(() => null);
  }

  const now = new Date();
  await database.previewEnvironment.update({
    where: { id: preview.id },
    data: {
      status: "EXPIRED",
      url: null,
      stoppedAt: now,
      lastHeartbeatAt: now,
    },
  }).catch(() => null);

  return { stopped: true, previewId: preview.id };
}
