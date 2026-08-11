import { describe, expect, it } from "vitest";

import { isAtLeastProjectRole } from "./access";

describe("isAtLeastProjectRole", () => {
  it("mantem a hierarquia Gestor, Desenvolvedor e Visualizador", () => {
    expect(isAtLeastProjectRole("MANAGER", "DEVELOPER")).toBe(true);
    expect(isAtLeastProjectRole("DEVELOPER", "VIEWER")).toBe(true);
    expect(isAtLeastProjectRole("VIEWER", "DEVELOPER")).toBe(false);
  });

  it("nega papeis ausentes ou desconhecidos", () => {
    expect(isAtLeastProjectRole(null, "VIEWER")).toBe(false);
    expect(isAtLeastProjectRole("UNKNOWN", "VIEWER")).toBe(false);
  });
});
