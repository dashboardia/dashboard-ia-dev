export const DEFAULT_AI_MODEL = "gpt-5.6-terra";

export const AI_MODELS = [
  {
    value: "gpt-5.6-luna",
    label: "Econômico",
    model: "GPT-5.6 Luna",
    description: "Demandas simples, documentação e ajustes pequenos.",
    relativeAiCost: 1,
  },
  {
    value: "gpt-5.6-terra",
    label: "Equilibrado",
    model: "GPT-5.6 Terra",
    description: "Recomendado para a maioria das implementações.",
    relativeAiCost: 10,
  },
  {
    value: "gpt-5.6-sol",
    label: "Avançado",
    model: "GPT-5.6 Sol",
    description: "Mudanças complexas, críticas ou de grande alcance.",
    relativeAiCost: 25,
  },
];

export const AI_MODEL_VALUES = AI_MODELS.map((option) => option.value);
export const FREE_PLAN_AI_MODEL = "gpt-5.6-luna";

export function aiModelRequiresPaidPlan(model) {
  return model !== FREE_PLAN_AI_MODEL;
}

export function getAiModel(model) {
  return AI_MODELS.find((option) => option.value === model) ?? AI_MODELS.find((option) => option.value === DEFAULT_AI_MODEL);
}
