import { describe, expect, it } from "vitest";

import { explainError, publicErrorMessage } from "./error-messages";

describe("error messages", () => {
  it("traduz falta de créditos sem esconder a ação necessária", () => {
    const result = explainError("429 You have no credits remaining");
    expect(result.title).toBe("Créditos da OpenAI esgotados");
    expect(result.action).toContain("Adicione créditos");
  });

  it("traduz falta de permissão do GitHub", () => {
    const result = explainError("remote: Permission to owner/repo denied to dashboardia. error: 403");
    expect(result.title).toBe("GitHub sem permissão para publicar");
    expect(result.action).toContain("GitHub App");
  });

  it("não expõe detalhes inesperados na mensagem pública", () => {
    expect(publicErrorMessage("detalhe interno desconhecido")).not.toContain("detalhe interno");
  });
});
