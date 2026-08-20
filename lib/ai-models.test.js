import { describe, expect, it } from "vitest";

import { AI_MODELS, FREE_PLAN_AI_MODEL, aiModelRequiresPaidPlan } from "./ai-models";
import { MODEL_PRICING } from "./financial-shadow";

describe("AI model catalog", () => {
  it("expõe custos relativos coerentes e deixa somente Luna no plano gratuito", () => {
    expect(Object.fromEntries(AI_MODELS.map((model) => [model.value, model.relativeAiCost]))).toEqual({
      "gpt-5.6-luna": 1,
      "gpt-5.6-terra": 10,
      "gpt-5.6-sol": 25,
    });
    expect(FREE_PLAN_AI_MODEL).toBe("gpt-5.6-luna");
    expect(aiModelRequiresPaidPlan("gpt-5.6-luna")).toBe(false);
    expect(aiModelRequiresPaidPlan("gpt-5.6-terra")).toBe(true);
    expect(aiModelRequiresPaidPlan("gpt-5.6-sol")).toBe(true);
    const luna = MODEL_PRICING["gpt-5.6-luna"];
    for (const model of AI_MODELS) {
      expect(MODEL_PRICING[model.value].input / luna.input).toBe(model.relativeAiCost);
      expect(MODEL_PRICING[model.value].output / luna.output).toBe(model.relativeAiCost);
    }
  });
});
