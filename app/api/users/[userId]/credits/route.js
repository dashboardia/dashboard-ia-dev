import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { BillingAccessError, ensureBillingAccount, grantCredits } from "../../../../../lib/billing";
import { db } from "../../../../../lib/db";
import { adminCreditGrantSchema } from "../../../../../lib/validation";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const input = adminCreditGrantSchema.parse(await request.json());
    const target = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, globalRole: true },
    });
    if (target.globalRole === "ADMIN") {
      throw new BillingAccessError("Contas administrativas já possuem créditos ilimitados.", 409, "ADMIN_UNLIMITED_CREDITS");
    }

    const account = await ensureBillingAccount(target);
    const expiresAt = new Date(Date.now() + input.validityDays * 86_400_000);
    const bucket = await db.$transaction(async (transaction) => {
      const granted = await grantCredits(transaction, {
        accountId: account.id,
        type: "ADJUSTMENT",
        credits: input.credits,
        expiresAt,
        description: `Crédito adicionado pelo administrador: ${input.reason}`,
      });
      await transaction.auditLog.create({
        data: auditData({
          actorId: actor.id,
          action: "user.credits.grant",
          entityType: "User",
          entityId: target.id,
          metadata: { credits: input.credits, validityDays: input.validityDays, reason: input.reason, accountId: account.id },
          request,
        }),
      });
      return granted;
    });

    return NextResponse.json({ granted: input.credits, expiresAt: bucket.expiresAt });
  } catch (error) {
    return apiError(error);
  }
}
