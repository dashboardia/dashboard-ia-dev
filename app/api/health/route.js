import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { getConfigurationStatus } from "../../../lib/env";
import { getWorkerRuntimeStatus } from "../../../lib/worker-heartbeat";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const configuration = getConfigurationStatus();
  let databaseReady = false;
  let workerReady = !configuration.worker;

  if (configuration.database) {
    try {
      await db.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      databaseReady = false;
    }
  }

  if (databaseReady && configuration.worker) {
    const runtime = await getWorkerRuntimeStatus().catch(() => ({ online: false }));
    workerReady = runtime.online === true;
  }

  const status = !databaseReady ? "unavailable" : workerReady ? "ok" : "degraded";
  return NextResponse.json(
    {
      service: "dashboardia",
      status,
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: databaseReady ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
