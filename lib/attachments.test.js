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

  it("aceita arquivos maiores e recusa os que ultrapassam 20 MB", () => {
    expect(() => validateAttachmentFiles([attachment("script.exe", "application/octet-stream")])).toThrow(/formato não permitido/);
    expect(validateAttachmentFiles([attachment("referencia.pdf", "application/pdf", 20_000_000)])).toHaveLength(1);
    expect(() => validateAttachmentFiles([attachment("grande.pdf", "application/pdf", 20_000_001)])).toThrow(/20 MB/);
  });

  it("aceita até dez anexos por mensagem", () => {
    expect(validateAttachmentFiles(Array.from({ length: 10 }, (_, index) => attachment(`print-${index}.png`, "image/png")))).toHaveLength(10);
    expect(validateAttachmentFiles(Array.from({ length: 11 }, (_, index) => attachment(`print-${index}.png`, "image/png")))).toHaveLength(10);
  });

  it("protege o tamanho total do envio sem expor o limite na mensagem", () => {
    expect(() => validateAttachmentFiles([
      attachment("parte-1.pdf", "application/pdf", 20_000_000),
      attachment("parte-2.pdf", "application/pdf", 20_000_000),
      attachment("parte-3.pdf", "application/pdf", 10_000_001),
    ])).toThrow("Os anexos desta mensagem são muito grandes para um único envio.");
  });

  it("normaliza tipo pelo nome e remove caminhos do arquivo", () => {
    expect(normalizeAttachmentType("tabela.xlsx", "application/octet-stream")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(sanitizeAttachmentName("../../meu\\arquivo.pdf")).toBe("..-..-meu-arquivo.pdf");
  });
});
