export const FINANCIAL_FORMULA_VERSION = "shadow-v1-2026-08-18";
export const LONG_CONTEXT_THRESHOLD = 272_000;

// Valores oficiais em micros de dólar por 1 milhão de tokens, congelados na versão acima.
export const MODEL_PRICING = {
  "gpt-5.6-luna": { input: 200_000, output: 1_200_000, source: "https://developers.openai.com/api/docs/models/gpt-5.6-luna" },
  "gpt-5.6-terra": { input: 2_000_000, output: 12_000_000, source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra" },
  "gpt-5.6-sol": { input: 5_000_000, output: 30_000_000, source: "https://developers.openai.com/api/docs/models/gpt-5.6-sol" },
};

function ceilDivide(numerator, denominator) {
  if (numerator <= 0) return 0;
  return Math.ceil(numerator / denominator);
}

export function calculateLiveUsageCredits({
  model,
  inputTokens,
  outputTokens,
  usdToBrlCents,
  aiSafetyPercent,
  creditValueCents,
  targetGrossMarginPercent,
}) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-5.6-terra"];
  const normalizedInput = Math.max(0, Number(inputTokens) || 0);
  const normalizedOutput = Math.max(0, Number(outputTokens) || 0);
  const longContext = normalizedInput > LONG_CONTEXT_THRESHOLD;
  const inputPrice = longContext ? pricing.input * 2 : pricing.input;
  const outputPrice = longContext ? Math.ceil(pricing.output * 1.5) : pricing.output;
  const aiCostUsdMicros = ceilDivide((normalizedInput * inputPrice) + (normalizedOutput * outputPrice), 1_000_000);
  const adjustedAiCostBrlCents = ceilDivide(
    aiCostUsdMicros * usdToBrlCents * (100 + aiSafetyPercent),
    100_000_000,
  );
  const internalCostPerCreditCents = Math.max(1, creditValueCents * (100 - targetGrossMarginPercent) / 100);
  return ceilDivide(adjustedAiCostBrlCents, internalCostPerCreditCents);
}

export function calculateFinancialSnapshot({ execution, settings, usage, endedAt = new Date() }) {
  const model = execution.model || execution.demand?.aiModel || "gpt-5.6-terra";
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-5.6-terra"];
  const inputTokens = Math.max(0, Number(usage?.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage?.outputTokens) || 0);
  const hasMeasuredUsage = Boolean(usage && Number.isFinite(Number(usage.inputTokens)) && Number.isFinite(Number(usage.outputTokens)));
  const longContext = inputTokens > LONG_CONTEXT_THRESHOLD;
  const inputPrice = longContext ? pricing.input * 2 : pricing.input;
  const outputPrice = longContext ? Math.ceil(pricing.output * 1.5) : pricing.output;
  const aiCostUsdMicros = hasMeasuredUsage
    ? ceilDivide((inputTokens * inputPrice) + (outputTokens * outputPrice), 1_000_000)
    : 0;
  const adjustedAiCostBrlCents = hasMeasuredUsage
    ? ceilDivide(aiCostUsdMicros * settings.usdToBrlCents * (100 + settings.aiSafetyPercent), 100_000_000)
    : 0;
  const startedAt = execution.startedAt ? new Date(execution.startedAt) : endedAt;
  const workerDurationSeconds = Math.max(0, Math.ceil((endedAt.getTime() - startedAt.getTime()) / 1000));
  const workerCostBrlCents = hasMeasuredUsage
    ? ceilDivide(workerDurationSeconds * settings.workerCostCentsPerHour, 3_600)
    : 0;
  const visualValidationCostBrlCents = hasMeasuredUsage && execution.demand?.visualValidation
    ? settings.visualValidationCostCents
    : 0;
  const totalInternalCostBrlCents = adjustedAiCostBrlCents + workerCostBrlCents + visualValidationCostBrlCents;
  const internalCostPerCreditCents = Math.max(1, settings.creditValueCents * (100 - settings.targetGrossMarginPercent) / 100);
  const simulatedConsumedCredits = hasMeasuredUsage ? ceilDivide(totalInternalCostBrlCents, internalCostPerCreditCents) : 0;
  const simulatedReservedCredits = hasMeasuredUsage
    ? Math.max(simulatedConsumedCredits, Math.ceil(simulatedConsumedCredits * (100 + settings.reservationBufferPercent) / 100))
    : 0;
  const simulatedCommercialValueBrlCents = simulatedConsumedCredits * settings.creditValueCents;
  const estimatedGrossMarginBasisPoints = simulatedCommercialValueBrlCents
    ? Math.round((simulatedCommercialValueBrlCents - totalInternalCostBrlCents) * 10_000 / simulatedCommercialValueBrlCents)
    : 0;

  return {
    mode: "SHADOW",
    formulaVersion: FINANCIAL_FORMULA_VERSION,
    calculationStatus: hasMeasuredUsage ? "MEASURED" : "NO_USAGE_DATA",
    model,
    inputTokens,
    outputTokens,
    inputPriceUsdMicrosPerMillion: inputPrice,
    outputPriceUsdMicrosPerMillion: outputPrice,
    aiCostUsdMicros,
    usdToBrlCents: settings.usdToBrlCents,
    aiSafetyPercent: settings.aiSafetyPercent,
    adjustedAiCostBrlCents,
    workerDurationSeconds,
    workerCostBrlCents,
    visualValidationCostBrlCents,
    totalInternalCostBrlCents,
    simulatedReservedCredits,
    simulatedConsumedCredits,
    simulatedCommercialValueBrlCents,
    estimatedGrossMarginBasisPoints,
    targetGrossMarginPercent: settings.targetGrossMarginPercent,
    wouldCharge: hasMeasuredUsage,
    pricingMetadata: {
      source: pricing.source,
      capturedAt: "2026-08-18",
      cachedInputTokensAvailable: false,
      inputAssumption: "uncached",
      longContextThresholdTokens: LONG_CONTEXT_THRESHOLD,
      longContextPricingApplied: longContext,
      longContextAssumption: "aggregate-input-used-as-request-proxy",
      reservationBufferPercent: settings.reservationBufferPercent,
      creditValueCents: settings.creditValueCents,
      internalCostPerCreditCents,
      creditAccountingEnabled: true,
      paymentChargingEnabled: false,
    },
    calculatedAt: endedAt,
  };
}

export async function saveFinancialSnapshot(database, { execution, settings, usage, endedAt = new Date() }) {
  const snapshot = calculateFinancialSnapshot({ execution, settings, usage, endedAt });
  if (!settings.financialShadowEnabled || !database.executionFinancialSnapshot) return snapshot;
  return database.executionFinancialSnapshot.upsert({
    where: { executionId: execution.id },
    update: snapshot,
    create: { executionId: execution.id, ...snapshot },
  });
}

export function formatBrlCents(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((cents || 0) / 100);
}
