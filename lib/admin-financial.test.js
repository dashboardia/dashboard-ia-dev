import { describe, expect, it } from "vitest";

import { buildClientFinancialMonthlySeries, buildClientFinancialRows, summarizeClientFinancialRows } from "./admin-financial";

describe("admin financial dashboard", () => {
  it("compara pagamentos confirmados com custos medidos por cliente", () => {
    const rows = buildClientFinancialRows([{
      ownerUserId: "user-1",
      owner: { name: "Cliente A", email: "cliente@example.com" },
      plan: "STUDIO",
      status: "ACTIVE",
      checkouts: [{ amountCents: 10_000 }, { amountCents: 5_000 }],
    }], [{
      model: "gpt-5.6-terra",
      inputTokens: 100,
      outputTokens: 20,
      aiCostUsdMicros: 100_000,
      usdToBrlCents: 500,
      adjustedAiCostBrlCents: 800,
      workerCostBrlCents: 100,
      visualValidationCostBrlCents: 50,
      totalInternalCostBrlCents: 950,
      execution: { demand: { project: { createdById: "user-1" } } },
    }]);

    expect(rows[0]).toMatchObject({ paidBrlCents: 15_000, aiCostBrlCents: 50, aiSafetyCostBrlCents: 750, directOperationalCostBrlCents: 200, totalInternalCostBrlCents: 950, resultBrlCents: 14_050, grossMarginPercent: 93.67, executions: 1 });
    expect(rows[0].models).toEqual(["gpt-5.6-terra"]);
    expect(summarizeClientFinancialRows(rows)).toMatchObject({ paidBrlCents: 15_000, totalInternalCostBrlCents: 950, resultBrlCents: 14_050 });
  });

  it("mantém margem indisponível quando o cliente ainda não pagou", () => {
    const [row] = buildClientFinancialRows([{ ownerUserId: "trial", owner: {}, plan: "TRIAL", status: "TRIALING", checkouts: [] }], []);
    expect(row.grossMarginPercent).toBeNull();
    expect(row.resultBrlCents).toBe(0);
  });

  it("agrupa receita confirmada e custos medidos pelo mês real de cada evento", () => {
    const series = buildClientFinancialMonthlySeries([
      { amountCents: 10_000, paidAt: new Date("2026-07-10T12:00:00Z") },
      { amountCents: 5_000, paidAt: new Date("2026-08-02T12:00:00Z") },
    ], [
      { calculatedAt: new Date("2026-08-03T12:00:00Z"), aiCostUsdMicros: 100_000, usdToBrlCents: 500, adjustedAiCostBrlCents: 900, totalInternalCostBrlCents: 900 },
    ]);

    expect(series).toEqual([
      { month: "2026-07", paidBrlCents: 10_000, aiCostBrlCents: 0, aiSafetyCostBrlCents: 0, workerCostBrlCents: 0, visualCostBrlCents: 0, directOperationalCostBrlCents: 0, totalInternalCostBrlCents: 0, executions: 0, resultBrlCents: 10_000, grossMarginPercent: 100 },
      { month: "2026-08", paidBrlCents: 5_000, aiCostBrlCents: 50, aiSafetyCostBrlCents: 850, workerCostBrlCents: 0, visualCostBrlCents: 0, directOperationalCostBrlCents: 50, totalInternalCostBrlCents: 900, executions: 1, resultBrlCents: 4_100, grossMarginPercent: 82 },
    ]);
  });
});
