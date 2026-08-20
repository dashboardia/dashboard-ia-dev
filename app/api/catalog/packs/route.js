import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../lib/api";
import { auditData } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { billingCreditPackCatalogSchema } from "../../../../lib/validation";

function editableData(input) {
  return {
    name: input.name,
    credits: input.credits,
    priceCents: input.priceCents,
    validityMonths: input.validityMonths,
    active: input.active,
    public: input.public,
    sortOrder: input.sortOrder,
  };
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = billingCreditPackCatalogSchema.parse(await request.json());
    const existing = await db.billingCreditPackCatalog.findUnique({ where: { code: input.code } });
    if (existing) return NextResponse.json({ error: "Já existe um pacote com este código." }, { status: 409 });
    const pack = await db.$transaction(async (transaction) => {
      const created = await transaction.billingCreditPackCatalog.create({ data: { code: input.code, structural: false, ...editableData(input) } });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.credit_pack.create", entityType: "BillingCreditPackCatalog", entityId: created.code, metadata: editableData(input), request }) });
      return created;
    });
    return NextResponse.json({ pack }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const input = billingCreditPackCatalogSchema.parse(await request.json());
    const current = await db.billingCreditPackCatalog.findUnique({ where: { code: input.code } });
    if (!current) return NextResponse.json({ error: "Pacote não encontrado." }, { status: 404 });
    const pack = await db.$transaction(async (transaction) => {
      const updated = await transaction.billingCreditPackCatalog.update({ where: { code: input.code }, data: editableData(input) });
      await transaction.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.credit_pack.update", entityType: "BillingCreditPackCatalog", entityId: updated.code, metadata: { before: editableData(current), after: editableData(input) }, request }) });
      return updated;
    });
    return NextResponse.json({ pack });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin();
    const code = String((await request.json())?.code ?? "").trim().toUpperCase();
    const pack = await db.billingCreditPackCatalog.findUnique({ where: { code } });
    if (!pack) return NextResponse.json({ error: "Pacote não encontrado." }, { status: 404 });
    if (pack.structural) return NextResponse.json({ error: "Este pacote é estrutural. Desative-o ou oculte-o em vez de excluir." }, { status: 409 });
    await db.$transaction([
      db.billingCreditPackCatalog.delete({ where: { code } }),
      db.auditLog.create({ data: auditData({ actorId: user.id, action: "billing.credit_pack.delete", entityType: "BillingCreditPackCatalog", entityId: code, metadata: { name: pack.name }, request }) }),
    ]);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
