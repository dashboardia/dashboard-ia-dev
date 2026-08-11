import { describe, expect, it } from "vitest";

import { demandInputSchema, projectInputSchema } from "./validation";

describe("projectInputSchema", () => {
  it("aceita um repositório GitHub válido", () => {
    const input = projectInputSchema.parse({
      name: "Dashboard IA",
      repositoryFullName: "dashboardia/dashboard-ia-dev",
      defaultBranch: "main",
    });
    expect(input.repositoryFullName).toBe("dashboardia/dashboard-ia-dev");
  });

  it("recusa repositório sem proprietário", () => {
    expect(() => projectInputSchema.parse({ name: "Dashboard IA", repositoryFullName: "dashboard-ia-dev" })).toThrow();
  });
});

describe("demandInputSchema", () => {
  it("exige contexto suficiente para execução", () => {
    expect(() => demandInputSchema.parse({
      projectId: "cm12345678901234567890123",
      title: "Corrigir login",
      description: "curta",
      type: "BUG",
    })).toThrow();
  });
});
