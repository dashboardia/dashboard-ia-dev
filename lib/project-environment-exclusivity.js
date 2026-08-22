import { ACTIVE_ENVIRONMENT_STATUSES, stopDevEnvironment } from "./dev-environments.js";
import { deleteDashboardiaPreview } from "./preview-host-client.js";

const ACTIVE_EXECUTION_PREVIEW_STATUSES = ["QUEUED", "BUILDING", "DEPLOYING", "READY", "STOPPING"];

export async function retireProjectEnvironments(database, projectId, options = {}) {
  const exceptDevEnvironmentId = options.exceptDevEnvironmentId ?? null;
  const exceptExecutionId = options.exceptExecutionId ?? null;

  const [devEnvironments, executionPreviews] = await Promise.all([
    database.devEnvironment.findMany({
      where: {
        projectId,
        status: { in: ACTIVE_ENVIRONMENT_STATUSES },
        ...(exceptDevEnvironmentId ? { id: { not: exceptDevEnvironmentId } } : {}),
      },
    }),
    database.previewEnvironment.findMany({
      where: {
        status: { in: ACTIVE_EXECUTION_PREVIEW_STATUSES },
        execution: {
          demand: { projectId },
          ...(exceptExecutionId ? { id: { not: exceptExecutionId } } : {}),
        },
      },
    }),
  ]);

  for (const environment of devEnvironments) {
    await stopDevEnvironment(database, environment).catch(async () => {
      await database.devEnvironment.update({
        where: { id: environment.id },
        data: { status: "EXPIRED", url: null, credentials: null, stoppedAt: new Date(), lastHeartbeatAt: new Date() },
      }).catch(() => null);
    });
  }

  for (const preview of executionPreviews) {
    await deleteDashboardiaPreview(preview.externalId ?? preview.id).catch(() => null);
    await database.previewEnvironment.update({
      where: { id: preview.id },
      data: { status: "EXPIRED", url: null, stoppedAt: new Date(), lastHeartbeatAt: new Date() },
    }).catch(() => null);
  }

  return {
    devEnvironments: devEnvironments.length,
    executionPreviews: executionPreviews.length,
    total: devEnvironments.length + executionPreviews.length,
  };
}
