import { describe, expect, it } from "vitest";

import { mutationRequestAllowed } from "./request-security";

function request(path, options = {}) {
  return new Request(`https://dashboardia.app${path}`, options);
}

describe("request security", () => {
  it("permite métodos de leitura", () => {
    expect(mutationRequestAllowed(request("/api/projects"))).toBe(true);
  });

  it("permite mutação da mesma origem", () => {
    expect(mutationRequestAllowed(request("/api/projects", {
      method: "POST",
      headers: { origin: "https://dashboardia.app", "sec-fetch-site": "same-origin" },
    }))).toBe(true);
  });

  it("bloqueia mutação originada por outro site", () => {
    expect(mutationRequestAllowed(request("/api/projects", {
      method: "POST",
      headers: { origin: "https://malicioso.example", "sec-fetch-site": "cross-site" },
    }))).toBe(false);
  });

  it("preserva callbacks de autenticação e webhooks externos", () => {
    const externalHeaders = { origin: "https://github.com", "sec-fetch-site": "cross-site" };
    expect(mutationRequestAllowed(request("/api/auth/callback/github", { method: "POST", headers: externalHeaders }))).toBe(true);
    expect(mutationRequestAllowed(request("/api/webhooks/github", { method: "POST", headers: externalHeaders }))).toBe(true);
  });
});
