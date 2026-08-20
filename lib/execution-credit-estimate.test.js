import { describe, expect, it } from "vitest";

import { estimateExecutionCredits } from "./execution-credit-estimate";

const demand = {
  aiModel: "gpt-5.6-terra",
  type: "BUG",
  title: "Corrigir login",
  description: "Ajustar a validação do formulário de acesso.",
  acceptanceCriteria: "Usuário válido deve conseguir entrar.",
  visualValidation: false,
  visualPaths: [],
};

describe("estimativa de créditos da execução", () => {
  it("reduz a reserva de uma correção pequena sem histórico", () => {
    expect(estimateExecutionCredits({ demand, bufferPercent: 20 })).toMatchObject({
      credits: 230,
      metadata: { method: "SCOPE", sampleSize: 0, scopeBand: "SMALL" },
    });
  });

  it("usa o histórico real de execuções semelhantes", () => {
    const estimate = estimateExecutionCredits({
      demand,
      historicalConsumedCredits: [80, 90, 100, 110, 120],
      bufferPercent: 20,
    });
    expect(estimate.credits).toBeLessThan(230);
    expect(estimate.metadata).toMatchObject({ method: "HISTORY_AND_SCOPE", sampleSize: 5, historicalBaseline: 100 });
  });

  it("aumenta a estimativa quando há mais escopo e validação visual", () => {
    const estimate = estimateExecutionCredits({
      demand: {
        ...demand,
        type: "FEATURE",
        description: "Implementar fluxo completo. ".repeat(100),
        visualValidation: true,
        visualPaths: ["/", "/conta", "/configuracoes"],
      },
      bufferPercent: 20,
    });
    expect(estimate.credits).toBeGreaterThan(500);
    expect(estimate.metadata.scopeBand).toBe("LARGE");
  });
});
