import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { globalSettingsSchema } from "../../../lib/validation";
import { stopPlatformExecutions } from "../../../lib/platform-processing";

export async function PATCH(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = globalSettingsSchema.parse(await request.json());
    const settings = await db.$transaction(async (transaction) => {
      const previous = await transaction.globalSettings.findUnique({ where: { id: "global" }, select: { executionProcessingEnabled: true } });
      const updated = await transaction.globalSettings.upsert({ where: { id: "global" }, update: input, create: { id: "global", ...input } });
      const stopped = previous?.executionProcessingEnabled !== false && !input.executionProcessingEnabled
        ? await stopPlatformExecutions(transaction)
        : null;
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "settings.update", entityType: "GlobalSettings", entityId: "global", metadata: input, request }) });
      return { updated, stopped };
    });
    return NextResponse.json({ settings: settings.updated, stopped: settings.stopped });
  } catch (error) {
    return apiError(error);
  }
}
