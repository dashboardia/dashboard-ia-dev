import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDashboardiaPreview, dashboardiaPreviewConfigured } from "../lib/preview-host-client.js";
import { queuePreviewEnvironment, transitionPreviewEnvironment } from "../lib/preview-environments.js";
import { env } from "../lib/env.js";
import { runProcess } from "./sandbox.mjs";

const MAX_PREVIEW_ARCHIVE_BYTES = 64 * 1024 * 1024;

async function createSourceArchive(projectDirectory, executionId) {
  const archivePath = path.join(os.tmpdir(), `dashboardia-preview-${executionId}.tar.gz`);
  await rm(archivePath, { force: true });
  await runProcess("tar", [
    "-czf", archivePath,
    "--exclude=.git",
    "--exclude=.env",
    "--exclude=.env.*",
    "--exclude=node_modules",
    "--exclude=.next",
    "--exclude=.forgeboard-venv",
    "--exclude=.tmp",
    "--exclude=target",
    "--exclude=build",
    "--exclude=dist",
    ".",
  ], { cwd: projectDirectory, timeout: 90_000 });
  const archiveStat = await stat(archivePath);
  if (archiveStat.size > MAX_PREVIEW_ARCHIVE_BYTES) throw new Error("O código do preview excede o limite compactado de 64 MB");
  return { archivePath, archive: await readFile(archivePath) };
}

export async function publishDashboardiaPreview({ database, execution, projectDirectory, runtime, log }) {
  const project = execution.demand.project;
  if (!dashboardiaPreviewConfigured()) {
    await log("preview", "Host próprio de previews não configurado; mantendo evidências visuais", "warn");
    return null;
  }
  if (!project.previewCommand || !project.previewPort) {
    await log("preview", "O projeto não possui comando e porta para publicar um preview navegável", "warn");
    return null;
  }

  const environment = await queuePreviewEnvironment(database, {
    executionId: execution.id,
    ttlMinutes: env.PREVIEW_TTL_MINUTES,
  });
  let archivePath;
  try {
    await log("preview", "Empacotando código para o ambiente temporário do Dashboardia");
    const source = await createSourceArchive(projectDirectory, execution.id);
    archivePath = source.archivePath;
    const remote = await createDashboardiaPreview({
      previewId: environment.id,
      archive: source.archive,
      configuration: {
        runtime,
        installCommand: project.installCommand,
        buildCommand: project.buildCommand,
        previewCommand: project.previewCommand,
        port: project.previewPort,
        ttlMinutes: env.PREVIEW_TTL_MINUTES,
      },
    });
    await database.previewEnvironment.update({
      where: { id: environment.id },
      data: { externalId: remote.id, runtime, port: project.previewPort, attempts: { increment: 1 } },
    });
    await log("preview", "Código enviado; o container temporário está sendo construído", "info", { previewId: remote.id });
    return remote;
  } catch (error) {
    await transitionPreviewEnvironment(database, environment.id, "FAILED", { error: error instanceof Error ? error.message : String(error) }).catch(() => null);
    await log("preview", "Não foi possível solicitar o container temporário; mantendo evidências visuais", "warn", {
      technical: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    if (archivePath) await rm(archivePath, { force: true }).catch(() => null);
  }
}
