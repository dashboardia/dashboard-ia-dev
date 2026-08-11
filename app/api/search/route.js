import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/access";
import { apiError } from "../../../lib/api";
import { searchDashboard } from "../../../lib/search";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await requireUser();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const results = await searchDashboard({ user, query });

    return NextResponse.json(results, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
