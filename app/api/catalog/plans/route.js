import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { billingPlanCatalogSchema } from "../../../../lib/validation";

function editableData(input) {
  return {
    name: input.name,
    description: input.description ?? null,
    priceCents: input.priceCents,
    includedCredits: input.includedCredits,
    projectLimit: input.projectLimit,
    parallelExecutionLimit: input.parallelExecutionLimit,
    trialDays: input.trialDays,
    active: input.active,
    public: input.public,
    sortOrder: input.sortOrder,
  };
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = billingPlanCatalogSchema.parse(await request.json());
    const existing = await db.billingPlanCatalog.findUnique({ where: { code: input.code } });
    if (existing) return NextResponse.json({ error: "Já existe um plano com este código." }, { status: 409 });
    const plan = await db.$transaction(async (transaction) => {
      const created = await transaction.billingPlanCatalog.create({ data: { code: input.code, structural: false, ...editableData(input) } });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.plan.create", entityType: "BillingPlanCatalog", entityId: created.code, metadata: editableData(input), request }) });
      return created;
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = billingPlanCatalogSchema.parse(await request.json());
    const current = await db.billingPlanCatalog.findUnique({ where: { code: input.code } });
    if (!current) return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    if (["TRIAL", "CUSTOM"].includes(current.code) && !input.active) {
      return NextResponse.json({ error: "Os planos Teste e Sob medida precisam permanecer ativos para o funcionamento da plataforma." }, { status: 409 });
    }
    const plan = await db.$transaction(async (transaction) => {
      const updated = await transaction.billingPlanCatalog.update({ where: { code: input.code }, data: editableData(input) });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.plan.update", entityType: "BillingPlanCatalog", entityId: updated.code, metadata: { before: editableData(current), after: editableData(input) }, request }) });
      return updated;
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const code = String((await request.json())?.code ?? "").trim().toUpperCase();
    const plan = await db.billingPlanCatalog.findUnique({
      where: { code },
      include: { _count: { select: { currentAccounts: true, pendingAccounts: true, checkouts: true } } },
    });
    if (!plan) return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    if (plan.structural) return NextResponse.json({ error: "Este plano é estrutural e não pode ser excluído. Você pode ocultá-lo ou desativá-lo quando permitido." }, { status: 409 });
    const uses = plan._count.currentAccounts + plan._count.pendingAccounts + plan._count.checkouts;
    if (uses > 0) return NextResponse.json({ error: "Este plano já possui histórico ou clientes vinculados. Desative-o em vez de excluir." }, { status: 409 });
    await db.$transaction([
      db.billingPlanCatalog.delete({ where: { code } }),
      db.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.plan.delete", entityType: "BillingPlanCatalog", entityId: code, metadata: { name: plan.name }, request }) }),
    ]);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
