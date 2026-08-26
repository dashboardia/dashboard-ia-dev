import { describe, expect, it } from "vitest";

import { CLARIFICATION_REQUIRED_MARKER, parseAgentOutcome } from "./agent-outcome.mjs";

describe("agent outcome", () => {
  it("identifica uma solicitação de esclarecimento e remove o marcador interno", () => {
    const result = parseAgentOutcome(`${CLARIFICATION_REQUIRED_MARKER}\n\nPreciso confirmar qual sistema fará a autenticação.`);

    expect(result).toEqual({
      clarificationRequired: true,
      message: "Preciso confirmar qual sistema fará a autenticação.",
    });
  });

  it("remove do resumo a declaração interna de que o agente não executou validações", () => {
    const result = parseAgentOutcome([
      "Implementei o cadastro e a listagem.",
      "Não executei instalação, build, lint, testes ou inicialização local, conforme solicitado.",
    ].join("\n\n"));

    expect(result.clarificationRequired).toBe(false);
    expect(result.message).toBe("Implementei o cadastro e a listagem.");
  });

  it("preserva informações úteis sobre alterações realizadas", () => {
    const result = parseAgentOutcome("Criei a API, a persistência e os dados demonstrativos.");

    expect(result).toEqual({
      clarificationRequired: false,
      message: "Criei a API, a persistência e os dados demonstrativos.",
    });
  });
});
