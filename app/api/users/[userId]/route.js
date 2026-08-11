import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { requireAdmin } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { assertUserAdministrationAllowed } from "../../../../lib/user-administration";
import { userAdministrationSchema } from "../../../../lib/validation";

export async function PATCH(request, context) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const input = userAdministrationSchema.parse(await request.json());
    const user = await db.$transaction(async (transaction) => {
      const target = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, globalRole: true, status: true },
      });
      const nextGlobalRole = input.globalRole ?? target.globalRole;
      const nextStatus = input.status ?? target.status;
      const activeAdminCount = await transaction.user.count({ where: { globalRole: "ADMIN", status: "ACTIVE" } });
      assertUserAdministrationAllowed({ actorId: actor.id, target, nextGlobalRole, nextStatus, activeAdminCount });

      const updated = await transaction.user.update({
        where: { id: userId },
        data: { globalRole: nextGlobalRole, status: nextStatus },
        select: { id: true, globalRole: true, status: true },
      });
      if (nextStatus === "SUSPENDED") {
        await transaction.session.deleteMany({ where: { userId } });
      }
      await transaction.auditLog.create({
        data: auditData({
          actorId: actor.id,
          action: "user.update_access",
          entityType: "User",
          entityId: userId,
          metadata: { before: target, after: updated },
          request,
        }),
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ user });
  } catch (error) {
    return apiError(error);
  }
}
