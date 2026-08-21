import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { publicExecutionAccessEnabled } from "../../../../lib/operational-access";
import { setPublicOperationalAccessEnabled } from "../../../../lib/public-operational-access";

export async function PATCH(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const payload = await request.json();
    if (typeof payload?.enabled !== "boolean") {
      return NextResponse.json({ error: "Informe enabled como booleano" }, { status: 400 });
    }
    if (payload.enabled && !publicExecutionAccessEnabled(env)) {
      return NextResponse.json({
        error: "A infraestrutura pública ainda não está liberada. Configure PUBLIC_EXECUTIONS_ENABLED=true e EXECUTION_ISOLATION_MODE=isolated-container no web e no worker.",
      }, { status: 409 });
    }
    const enabled = await setPublicOperationalAccessEnabled(payload.enabled, db);
    await db.auditLog.create({
      data: auditData({
        actorId: user.id,
        action: "settings.public_operational_access.update",
        entityType: "GlobalSettings",
        entityId: "global",
        metadata: { enabled },
        request,
      }),
    });
    return NextResponse.json({ enabled });
  } catch (error) {
    return apiError(error);
  }
}
