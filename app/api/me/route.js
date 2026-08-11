import { NextResponse } from "next/server";

import { AccessDeniedError, requireUser } from "../../../lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
