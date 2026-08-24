import { describe, expect, it } from "vitest";

import { explainError, publicErrorMessage } from "./error-messages";

describe("error messages", () => {
  it("diferencia o saldo do cliente dos créditos técnicos da OpenAI", () => {
    const result = explainError("A execução ultrapassou o limite de 6 créditos, calculado sobre 5 créditos disponíveis.");
    expect(result.title).toBe("Créditos insuficientes para continuar");
    expect(result.action).toContain("mesma demanda");
  });

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

  it("orienta quando um repositório privado não foi autorizado", () => {
    const result = explainError("GitHub: Not Found");
    expect(result.title).toBe("Repositório não autorizado no GitHub");
    expect(result.action).toContain("este repositório foi selecionado");
    expect(result.technical).toBe("GitHub: Not Found");
  });

  it("não expõe detalhes inesperados na mensagem pública", () => {
    expect(publicErrorMessage("detalhe interno desconhecido")).not.toContain("detalhe interno");
  });
});
