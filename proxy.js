import { NextResponse } from "next/server";

import { mutationRequestAllowed } from "./lib/request-security.js";

export function proxy(request) {
  if (mutationRequestAllowed(request)) return NextResponse.next();
  return NextResponse.json(
    { error: "Origem da requisição não autorizada" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export const config = {
  matcher: "/api/:path*",
};
