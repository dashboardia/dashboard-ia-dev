import { describe, expect, it } from "vitest";

import { calculateFinancialSnapshot, calculateLiveUsageCredits, MODEL_PRICING } from "./financial-shadow";
import { defaultGlobalSettings } from "./global-settings";

function execution(overrides = {}) {
  return {
    id: "execution-1",
    model: "gpt-5.6-terra",
    startedAt: new Date("2026-08-18T10:00:00Z"),
    demand: { aiModel: "gpt-5.6-terra", visualValidation: false },
    ...overrides,
  };
}

describe("calculateFinancialSnapshot", () => {
  it("simula custo, reserva e consumo sem habilitar cobrança real", () => {
    const snapshot = calculateFinancialSnapshot({
      execution: execution(),
      settings: defaultGlobalSettings,
      usage: { inputTokens: 100_000, outputTokens: 10_000 },
      endedAt: new Date("2026-08-18T10:30:00Z"),
    });

    expect(snapshot.aiCostUsdMicros).toBe(320_000);
    expect(snapshot.adjustedAiCostBrlCents).toBe(221);
    expect(snapshot.workerCostBrlCents).toBe(50);
    expect(snapshot.totalInternalCostBrlCents).toBe(271);
    expect(snapshot.simulatedConsumedCredits).toBe(136);
    expect(snapshot.simulatedReservedCredits).toBe(164);
    expect(snapshot.simulatedCommercialValueBrlCents).toBe(1_360);
    expect(snapshot.pricingMetadata.creditAccountingEnabled).toBe(true);
    expect(snapshot.pricingMetadata.paymentChargingEnabled).toBe(false);
    expect(snapshot.wouldCharge).toBe(true);
  });

  it("aplica tarifa oficial de contexto longo e custo visual configurado", () => {
    const snapshot = calculateFinancialSnapshot({
      execution: execution({ model: "gpt-5.6-sol", demand: { aiModel: "gpt-5.6-sol", visualValidation: true } }),
      settings: defaultGlobalSettings,
      usage: { inputTokens: 272_001, outputTokens: 1_000 },
      endedAt: new Date("2026-08-18T10:00:01Z"),
      visualValidationPerformed: true,
    });

    expect(snapshot.inputPriceUsdMicrosPerMillion).toBe(MODEL_PRICING["gpt-5.6-sol"].input * 2);
    expect(snapshot.outputPriceUsdMicrosPerMillion).toBe(MODEL_PRICING["gpt-5.6-sol"].output * 1.5);
    expect(snapshot.visualValidationCostBrlCents).toBe(10);
    expect(snapshot.pricingMetadata.longContextPricingApplied).toBe(true);
  });

  it("acumula tokens e custos de cada rodada sem contar o tempo de espera do cliente", () => {
    const snapshot = calculateFinancialSnapshot({
      execution: execution(),
      settings: defaultGlobalSettings,
      usage: { inputTokens: 120_000, outputTokens: 12_000 },
      runStartedAt: new Date("2026-08-18T15:00:00Z"),
      endedAt: new Date("2026-08-18T15:05:00Z"),
      previousSnapshot: { workerDurationSeconds: 1_800, visualValidationCostBrlCents: 10 },
    });

    expect(snapshot.inputTokens).toBe(120_000);
    expect(snapshot.outputTokens).toBe(12_000);
    expect(snapshot.workerDurationSeconds).toBe(2_100);
    expect(snapshot.visualValidationCostBrlCents).toBe(10);
  });

  it("registra zero e sinaliza ausência de medição quando o agente não devolve uso", () => {
    const snapshot = calculateFinancialSnapshot({ execution: execution(), settings: defaultGlobalSettings });
    expect(snapshot.calculationStatus).toBe("NO_USAGE_DATA");
    expect(snapshot.totalInternalCostBrlCents).toBe(0);
    expect(snapshot.simulatedConsumedCredits).toBe(0);
    expect(snapshot.wouldCharge).toBe(false);
  });
});

describe("live execution credit budget", () => {
  it("converte o uso acumulado do agente em créditos com a política financeira vigente", () => {
    const credits = calculateLiveUsageCredits({
      model: "gpt-5.6-sol",
      inputTokens: 100_000,
      outputTokens: 50_000,
      usdToBrlCents: 600,
      aiSafetyPercent: 15,
      creditValueCents: 10,
      targetGrossMarginPercent: 80,
    });

    expect(credits).toBeGreaterThan(0);
    expect(credits).toBeLessThan(10_000);
  });
});
