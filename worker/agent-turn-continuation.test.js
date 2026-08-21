import { describe, expect, it } from "vitest";

import { continuationPrompt, isAgentTurnLimitError, maxTurnSegmentsForPolicy } from "./agent-turn-continuation.mjs";

describe("agent turn continuation", () => {
  it("reconhece o erro real de limite de turns", () => {
    expect(isAgentTurnLimitError(new Error("Max turns (48) exceeded"))).toBe(true);
    expect(isAgentTurnLimitError(new Error("rate limit"))).toBe(false);
  });

  it("oferece mais segmentos para execuções complexas ou potência máxima", () => {
    expect(maxTurnSegmentsForPolicy({ scope: "STANDARD", powerMode: "BALANCED" })).toBe(3);
    expect(maxTurnSegmentsForPolicy({ scope: "COMPLEX", powerMode: "BALANCED" })).toBe(4);
    expect(maxTurnSegmentsForPolicy({ scope: "STANDARD", powerMode: "MAXIMUM" })).toBe(4);
  });

  it("instrui a continuação sem reiniciar o trabalho", () => {
    const prompt = continuationPrompt("Implemente a demanda", 2, 4);
    expect(prompt).toContain("Implemente a demanda");
    expect(prompt).toContain("preserve todo o trabalho válido");
    expect(prompt).toContain("Não recomece o projeto");
  });
});
