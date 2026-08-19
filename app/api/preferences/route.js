import { NextResponse } from "next/server";

import { AccessDeniedError, requireUser } from "../../../lib/access";
import { db } from "../../../lib/db";
import { normalizePreferences, LOCALES, THEMES } from "../../../lib/user-preferences";

export async function PUT(request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    if (!THEMES.includes(body.theme) || !LOCALES.includes(body.locale)) return NextResponse.json({ error: "Preferências inválidas" }, { status: 400 });
    const preferences = normalizePreferences(body);
    await db.user.update({ where: { id: user.id }, data: preferences });
    return NextResponse.json(preferences);
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccessDeniedError ? error.message : "Não foi possível salvar as preferências" }, { status: error instanceof AccessDeniedError ? error.status : 500 });
  }
}
