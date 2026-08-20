import { describe, expect, it } from "vitest";

import { buildClientFinancialRows, summarizeClientFinancialRows } from "./admin-financial";

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

    expect(rows[0]).toMatchObject({ paidBrlCents: 15_000, aiCostBrlCents: 50, totalInternalCostBrlCents: 950, resultBrlCents: 14_050, grossMarginPercent: 93.67, executions: 1 });
    expect(rows[0].models).toEqual(["gpt-5.6-terra"]);
    expect(summarizeClientFinancialRows(rows)).toMatchObject({ paidBrlCents: 15_000, totalInternalCostBrlCents: 950, resultBrlCents: 14_050 });
  });

  it("mantém margem indisponível quando o cliente ainda não pagou", () => {
    const [row] = buildClientFinancialRows([{ ownerUserId: "trial", owner: {}, plan: "TRIAL", status: "TRIALING", checkouts: [] }], []);
    expect(row.grossMarginPercent).toBeNull();
    expect(row.resultBrlCents).toBe(0);
  });
});
