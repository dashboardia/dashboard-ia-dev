import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { AccessDeniedError, requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { demandId } = await context.params;
    const demand = await db.demand.findUniqueOrThrow({ where: { id: demandId } });
    const { user } = await requireProjectRole(demand.projectId, "MANAGER");
    const updated = await db.$transaction(async (transaction) => {
      const current = await transaction.demand.findUniqueOrThrow({ where: { id: demandId }, select: { status: true } });
      if (current.status !== "PENDING_APPROVAL") {
        throw new AccessDeniedError("A demanda não está aguardando aprovação", 409);
      }
      const result = await transaction.demand.update({
        where: { id: demandId },
        data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId: demand.projectId, action: "demand.approve", entityType: "Demand", entityId: demandId, request }),
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ demand: updated });
  } catch (error) {
    return apiError(error);
  }
}
