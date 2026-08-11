import { describe, expect, it } from "vitest";

import { toSlug } from "./slug";

describe("toSlug", () => {
  it("normaliza nomes de projetos para URLs estaveis", () => {
    expect(toSlug("Painel Financeiro — Produção")).toBe("painel-financeiro-producao");
  });

  it("limita o identificador sem deixar separador no final", () => {
    expect(toSlug(`${"projeto-".repeat(20)}final`)).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(toSlug(`${"projeto-".repeat(20)}final`)).not.toMatch(/-$/);
  });
});
