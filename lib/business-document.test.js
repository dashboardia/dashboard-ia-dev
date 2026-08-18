import { describe, expect, it } from "vitest";

import {
  documentationFilename,
  documentationResponseMetadata,
  generateBusinessDocx,
  generateBusinessPdf,
  parseBusinessMarkdown,
} from "./business-document.js";

const documentation = {
  title: "Visão do Negócio: Área do Cliente",
  projectName: "Portal",
  repository: "empresa/portal",
  generatedAt: new Date("2026-08-18T12:00:00Z"),
  content: "# Visão geral\n\nO portal atende **clientes**.\n\n## Funcionalidades\n\n- Consultar pedidos\n- Atualizar cadastro\n\n| Perfil | Acesso |\n| --- | --- |\n| Cliente | Próprios dados |",
};

describe("documentação de negócio", () => {
  it("interpreta os principais blocos do Markdown", () => {
    expect(parseBusinessMarkdown(documentation.content).map((block) => block.type)).toEqual(["heading", "paragraph", "heading", "list", "table"]);
  });

  it("gera um nome de arquivo seguro e estável", () => {
    expect(documentationFilename(documentation.title, "pdf")).toBe("visao-do-negocio-area-do-cliente.pdf");
  });

  it("define metadados de download somente para formatos permitidos", () => {
    expect(documentationResponseMetadata("docx", documentation.title)?.contentType).toContain("wordprocessingml");
    expect(documentationResponseMetadata("pdf", documentation.title)?.contentDisposition).toContain("attachment");
    expect(documentationResponseMetadata("html", documentation.title)).toBeNull();
  });

  it("gera arquivos DOCX e PDF válidos", async () => {
    const [docx, pdf] = await Promise.all([generateBusinessDocx(documentation), generateBusinessPdf(documentation)]);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(docx.length).toBeGreaterThan(5_000);
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
