import { NextResponse } from "next/server";

import { getActionCenter } from "../../../lib/action-center";
import { requireUser } from "../../../lib/access";
import { apiError } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const result = await getActionCenter({ user });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
