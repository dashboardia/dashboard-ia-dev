import { describe, expect, it } from "vitest";

import { isAtLeastProjectRole, isConfiguredAdmin } from "./access";

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

describe("isConfiguredAdmin", () => {
  it("reconhece o login configurado sem diferenciar maiusculas ou espacos", () => {
    expect(isConfiguredAdmin(" DashboardIA ", "dashboardia")).toBe(true);
  });

  it("nao promove outro login nem opera sem configuracao", () => {
    expect(isConfiguredAdmin("outro-usuario", "dashboardia")).toBe(false);
    expect(isConfiguredAdmin("dashboardia", undefined)).toBe(false);
  });

  it("nao aceita login vazio como administrador", () => {
    expect(isConfiguredAdmin(null, "dashboardia")).toBe(false);
    expect(isConfiguredAdmin("   ", "dashboardia")).toBe(false);
  });
});
