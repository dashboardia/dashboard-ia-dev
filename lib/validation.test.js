import { describe, expect, it } from "vitest";

import { demandInputSchema, projectInputSchema, projectUpdateSchema } from "./validation";

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

describe("projectUpdateSchema", () => {
  it("permite limpar configurações opcionais sem alterar o repositório", () => {
    const input = projectUpdateSchema.parse({ productionUrl: "", buildCommand: "" });
    expect(input).toEqual({ productionUrl: null, buildCommand: null });
    expect(projectUpdateSchema.parse({ repositoryFullName: "outro/repositorio", name: "Portal" })).toEqual({ name: "Portal" });
  });

  it("recusa diretório de trabalho fora do repositório", () => {
    expect(() => projectUpdateSchema.parse({ workingDirectory: "../outro" })).toThrow("diretório relativo");
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
