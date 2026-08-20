import { executionReservationCredits } from "./billing-plans.js";

const TYPE_MULTIPLIER = {
  BUG: 0.85,
  FEATURE: 1.2,
  REFACTOR: 1.1,
  TEST: 0.8,
  INVESTIGATION: 0.75,
  DOCUMENTATION: 0.6,
};

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function textScope(length) {
  if (length <= 350) return { band: "SMALL", multiplier: 0.75 };
  if (length <= 900) return { band: "MODERATE", multiplier: 0.9 };
  if (length <= 1_800) return { band: "DETAILED", multiplier: 1 };
  if (length <= 3_500) return { band: "LARGE", multiplier: 1.15 };
  return { band: "EXTENSIVE", multiplier: 1.3 };
}

function roundToFive(value) {
  return Math.max(5, Math.ceil(value / 5) * 5);
}

export function estimateExecutionCredits({ demand, historicalConsumedCredits = [], bufferPercent = 20 }) {
  const modelBase = executionReservationCredits(demand.aiModel);
  const history = historicalConsumedCredits
    .map((value) => Math.ceil(Number(value) || 0))
    .filter((value) => value > 0)
    .slice(0, 30);
  const historicalBaseline = history.length >= 3 ? percentile(history, 0.6) : null;
  const baseline = historicalBaseline == null
    ? modelBase
    : Math.round((historicalBaseline * 0.7) + (modelBase * 0.3));
  const narrativeLength = [demand.title, demand.description, demand.acceptanceCriteria]
    .filter(Boolean)
    .join(" ").length;
  const scope = textScope(narrativeLength);
  const visualPaths = Array.isArray(demand.visualPaths) ? demand.visualPaths.filter(Boolean).length : 0;
  const visualMultiplier = demand.visualValidation ? 1.12 + Math.min(0.12, visualPaths * 0.02) : 1;
  const typeMultiplier = TYPE_MULTIPLIER[demand.type] ?? 1;
  const normalizedBuffer = Math.min(100, Math.max(0, Number(bufferPercent) || 0));
  const rawEstimate = baseline * scope.multiplier * typeMultiplier * visualMultiplier * (1 + normalizedBuffer / 100);
  const minimum = modelBase * 0.4;
  const maximum = modelBase * 3;

  return {
    credits: roundToFive(Math.min(maximum, Math.max(minimum, rawEstimate))),
    metadata: {
      formulaVersion: "scope-history-v1",
      method: historicalBaseline == null ? "SCOPE" : "HISTORY_AND_SCOPE",
      sampleSize: history.length,
      modelBase,
      historicalBaseline,
      demandType: demand.type,
      scopeBand: scope.band,
      narrativeLength,
      visualValidation: Boolean(demand.visualValidation),
      bufferPercent: normalizedBuffer,
    },
  };
}
