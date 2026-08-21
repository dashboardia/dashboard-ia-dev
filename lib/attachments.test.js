import { describe, expect, it } from "vitest";

import { normalizeAttachmentType, sanitizeAttachmentName, validateAttachmentFiles } from "./attachments";

function attachment(name, type, size = 100) {
  return { name, type, size };
}

describe("message attachments", () => {
  it("aceita imagens, PDF, Word e Excel pequenos", () => {
    const result = validateAttachmentFiles([
      attachment("print.png", "image/png"),
      attachment("regra.pdf", "application/pdf"),
      attachment("escopo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      attachment("dados.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ]);
    expect(result.map((item) => item.mimeType)).toEqual([
      "image/png",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
  });

  it("recusa executáveis e arquivos maiores que o limite", () => {
    expect(() => validateAttachmentFiles([attachment("script.exe", "application/octet-stream")])).toThrow(/formato não permitido/);
    expect(() => validateAttachmentFiles([attachment("grande.pdf", "application/pdf", 5_000_001)])).toThrow(/5 MB/);
  });

  it("normaliza tipo pelo nome e remove caminhos do arquivo", () => {
    expect(normalizeAttachmentType("tabela.xlsx", "application/octet-stream")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(sanitizeAttachmentName("../../meu\\arquivo.pdf")).toBe("..-..-meu-arquivo.pdf");
  });
});
