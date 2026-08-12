import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { env, getConfigurationStatus } from "../../../lib/env";
import { getWorkerRuntimeStatus } from "../../../lib/worker-heartbeat";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const configuration = getConfigurationStatus();
  let database = configuration.database ? "unavailable" : "not-configured";
  let worker = configuration.worker ? "offline" : "not-configured";

  if (configuration.database) {
    try {
      await db.$queryRaw`SELECT 1`;
      database = "connected";
    } catch {
      database = "unavailable";
    }
  }
  if (database === "connected" && configuration.worker) {
    const runtime = await getWorkerRuntimeStatus().catch(() => ({ online: false }));
    worker = runtime.online ? "online" : "offline";
  }

  const status = database === "unavailable" || worker === "offline" ? "degraded" : "ok";

  return NextResponse.json(
    {
      service: "forgeboard",
      status,
      database,
      worker,
      configuration,
      commit: env.RAILWAY_GIT_COMMIT_SHA ?? null,
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
