import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./next.config.mjs";

describe("security headers", () => {
  it("publica CSP e HSTS em produção", () => {
    const headers = new Map(buildSecurityHeaders(true).map((header) => [header.key, header.value]));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
