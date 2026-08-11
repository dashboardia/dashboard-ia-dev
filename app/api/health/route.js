import { NextResponse } from "next/server";

import { db } from "../../../lib/db";
import { env, getConfigurationStatus } from "../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const configuration = getConfigurationStatus();
  let database = configuration.database ? "unavailable" : "not-configured";

  if (configuration.database) {
    try {
      await db.$queryRaw`SELECT 1`;
      database = "connected";
    } catch {
      database = "unavailable";
    }
  }

  const status = database === "unavailable" ? "degraded" : "ok";

  return NextResponse.json(
    {
      service: "forgeboard",
      status,
      database,
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
