import { describe, expect, it } from "vitest";

import { isGitHubAuthorizationFailure } from "./github-authorization-recovery";

describe("GitHub authorization recovery", () => {
  it("detecta push negado pelo GitHub", () => {
    expect(isGitHubAuthorizationFailure("remote: Permission to owner/repo.git denied to dashboardia. requested URL returned error: 403")).toBe(true);
  });

  it("detecta repositório privado ainda não autorizado", () => {
    expect(isGitHubAuthorizationFailure("GitHub: Not Found")).toBe(true);
  });

  it("não confunde falha de build com autorização", () => {
    expect(isGitHubAuthorizationFailure("vite build failed: Unexpected token" )).toBe(false);
  });
});
