import { describe, expect, it } from "vitest";

import { buildPreviewRepairPrompt, MAX_PREVIEW_REPAIR_ATTEMPTS } from "./preview-repair.mjs";

describe("preview repair", () => {
  it("orienta a correção da causa raiz e dos campos obrigatórios de auditoria", () => {
    const prompt = buildPreviewRepairPrompt({
      technical: "NULL not allowed for column CREATEDAT",
      demandPrompt: "Criar aplicação Java com persistência",
      attempt: 2,
      previousErrors: ["CellStyle.SOLID_FOREGROUND não existe"],
    });

    expect(MAX_PREVIEW_REPAIR_ATTEMPTS).toBe(3);
    expect(prompt).toContain("Tentativa 2 de 3");
    expect(prompt).toContain("createdAt, updatedAt e version");
    expect(prompt).toContain("CellStyle.SOLID_FOREGROUND não existe");
    expect(prompt).toContain("NULL not allowed for column CREATEDAT");
    expect(prompt).toContain("não substitua a aplicação por conteúdo estático");
  });

  it("marca explicitamente a primeira tentativa quando não há histórico", () => {
    expect(buildPreviewRepairPrompt({ technical: "erro", demandPrompt: "demanda", attempt: 1 }))
      .toContain("Esta é a primeira tentativa de reparo");
  });
});
