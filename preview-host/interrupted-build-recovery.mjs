const INTERRUPTED_PREVIEW_STATUSES = new Set(["QUEUED", "BUILDING", "DEPLOYING"]);

export function interruptedBuildRecoveryDecision(state, archiveAvailable) {
  if (!state || !INTERRUPTED_PREVIEW_STATUSES.has(state.status)) return { action: "IGNORE" };
  if (archiveAvailable && state.recoveryConfiguration) {
    return { action: "RESUME", configuration: state.recoveryConfiguration };
  }
  return { action: "FAIL" };
}

export function nextReadyFailure(previous, now, { threshold, graceMs }) {
  const firstAt = Number(previous?.firstAt) || now;
  const record = {
    count: Math.max(0, Number(previous?.count) || 0) + 1,
    firstAt,
    lastAt: now,
  };
  return {
    record,
    shouldRecover: record.count >= threshold && now - firstAt >= graceMs,
  };
}
