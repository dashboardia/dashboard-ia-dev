const INTERRUPTED_PREVIEW_STATUSES = new Set(["QUEUED", "BUILDING", "DEPLOYING"]);

export function interruptedBuildRecoveryDecision(state, archiveAvailable) {
  if (!state || !INTERRUPTED_PREVIEW_STATUSES.has(state.status)) return { action: "IGNORE" };
  if (archiveAvailable && state.recoveryConfiguration) {
    return { action: "RESUME", configuration: state.recoveryConfiguration };
  }
  return { action: "FAIL" };
}
