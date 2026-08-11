import { NextResponse } from "next/server";

import { requireProjectRole, requireUser } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const currentUser = await requireUser();
    const { demandId } = await context.params;
    const demand = await db.demand.findUniqueOrThrow({ where: { id: demandId } });
    const { user } = await requireProjectRole(demand.projectId, "MANAGER");
    if (currentUser.id !== user.id) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
    if (demand.status !== "PENDING_APPROVAL") {
      return NextResponse.json({ error: "A demanda não está aguardando aprovação" }, { status: 409 });
    }
    const updated = await db.demand.update({
      where: { id: demandId },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });
    await db.auditLog.create({
      data: auditData({ actorId: user.id, projectId: demand.projectId, action: "demand.approve", entityType: "Demand", entityId: demandId, request }),
    });
    return NextResponse.json({ demand: updated });
  } catch (error) {
    return apiError(error);
  }
}
