import { db } from "../lib/db.js";

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

async function checkProject({ project, client, fetchImpl, timeoutMs }) {
  const startedAt = Date.now();
  let status = "DOWN";
  let statusCode = null;
  let summary = null;
  try {
    const response = await fetchImpl(project.productionUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Forgeboard-Health/1.0" },
    });
    statusCode = response.status;
    status = response.ok ? "HEALTHY" : response.status < 500 ? "DEGRADED" : "DOWN";
    summary = `HTTP ${response.status}`;
    await response.body?.cancel().catch(() => null);
  } catch (error) {
    summary = error instanceof Error ? error.message.slice(0, 240) : "Falha na verificação";
  }
  await client.healthCheck.create({
    data: {
      projectId: project.id,
      status,
      statusCode,
      responseTimeMs: Date.now() - startedAt,
      summary,
    },
  });
}

export async function checkProjectHealth({ client = db, fetchImpl = fetch, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const projects = await client.project.findMany({
    where: { status: "ACTIVE", productionUrl: { not: null } },
    select: { id: true, productionUrl: true },
    orderBy: { id: "asc" },
  });

  const batchSize = Math.max(1, Math.min(Math.trunc(concurrency) || DEFAULT_CONCURRENCY, 25));
  for (let index = 0; index < projects.length; index += batchSize) {
    const batch = projects.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((project) => checkProject({ project, client, fetchImpl, timeoutMs })));
  }
}

export async function pruneHealthChecks(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  return db.healthCheck.deleteMany({ where: { checkedAt: { lt: cutoff } } });
}
