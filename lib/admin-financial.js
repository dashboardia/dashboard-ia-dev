export function buildClientFinancialRows(accounts, snapshots) {
  const rows = new Map((accounts || []).map((account) => [account.ownerUserId, {
    userId: account.ownerUserId,
    name: account.owner?.name ?? account.owner?.githubLogin ?? account.owner?.email ?? "Cliente sem nome",
    email: account.owner?.email ?? "—",
    plan: account.plan,
    status: account.status,
    paidBrlCents: (account.checkouts || []).reduce((total, checkout) => total + Math.max(0, checkout.amountCents || 0), 0),
    executions: 0,
    inputTokens: 0,
    outputTokens: 0,
    aiCostBrlCents: 0,
    workerCostBrlCents: 0,
    visualCostBrlCents: 0,
    totalInternalCostBrlCents: 0,
    models: new Set(),
  }]));

  for (const snapshot of snapshots || []) {
    const userId = snapshot.execution?.demand?.project?.createdById;
    const row = rows.get(userId);
    if (!row) continue;
    row.executions += 1;
    row.inputTokens += Math.max(0, snapshot.inputTokens || 0);
    row.outputTokens += Math.max(0, snapshot.outputTokens || 0);
    const measuredAiCostBrlCents = snapshot.aiCostUsdMicros != null && snapshot.usdToBrlCents != null
      ? Math.ceil(Math.max(0, snapshot.aiCostUsdMicros) * Math.max(0, snapshot.usdToBrlCents) / 1_000_000)
      : Math.max(0, snapshot.adjustedAiCostBrlCents || 0);
    row.aiCostBrlCents += measuredAiCostBrlCents;
    row.workerCostBrlCents += Math.max(0, snapshot.workerCostBrlCents || 0);
    row.visualCostBrlCents += Math.max(0, snapshot.visualValidationCostBrlCents || 0);
    row.totalInternalCostBrlCents += Math.max(0, snapshot.totalInternalCostBrlCents || 0);
    if (snapshot.model) row.models.add(snapshot.model);
  }

  return [...rows.values()].map((row) => {
    const resultBrlCents = row.paidBrlCents - row.totalInternalCostBrlCents;
    return {
      ...row,
      models: [...row.models].sort(),
      resultBrlCents,
      grossMarginPercent: row.paidBrlCents ? Math.round(resultBrlCents * 10_000 / row.paidBrlCents) / 100 : null,
    };
  }).sort((left, right) => right.paidBrlCents - left.paidBrlCents || right.totalInternalCostBrlCents - left.totalInternalCostBrlCents);
}

export function summarizeClientFinancialRows(rows) {
  const summary = (rows || []).reduce((total, row) => ({
    paidBrlCents: total.paidBrlCents + row.paidBrlCents,
    aiCostBrlCents: total.aiCostBrlCents + row.aiCostBrlCents,
    totalInternalCostBrlCents: total.totalInternalCostBrlCents + row.totalInternalCostBrlCents,
    executions: total.executions + row.executions,
  }), { paidBrlCents: 0, aiCostBrlCents: 0, totalInternalCostBrlCents: 0, executions: 0 });
  summary.resultBrlCents = summary.paidBrlCents - summary.totalInternalCostBrlCents;
  summary.grossMarginPercent = summary.paidBrlCents
    ? Math.round(summary.resultBrlCents * 10_000 / summary.paidBrlCents) / 100
    : null;
  return summary;
}
