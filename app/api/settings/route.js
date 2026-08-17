import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { globalSettingsSchema } from "../../../lib/validation";

export async function PATCH(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = globalSettingsSchema.parse(await request.json());
    const settings = await db.$transaction(async (transaction) => {
      const updated = await transaction.globalSettings.upsert({ where: { id: "global" }, update: input, create: { id: "global", ...input } });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "settings.update", entityType: "GlobalSettings", entityId: "global", metadata: input, request }) });
      return updated;
    });
    return NextResponse.json({ settings });
  } catch (error) {
    return apiError(error);
  }
}
