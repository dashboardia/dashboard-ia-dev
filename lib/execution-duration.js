export function formatExecutionDuration(startedAt, finishedAt = null, now = new Date()) {
  if (!startedAt) return "Não iniciada";
  const started = new Date(startedAt);
  const ended = finishedAt ? new Date(finishedAt) : new Date(now);
  const seconds = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}min ${seconds % 60}s`;
}
