import os from "node:os";
import process from "node:process";

import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { claimNextExecution, recoverStaleExecutions } from "../lib/executions.js";
import { pruneWorkerHeartbeats, recordWorkerHeartbeat, removeWorkerHeartbeat } from "../lib/worker-heartbeat.js";
import { checkProjectHealth, pruneHealthChecks } from "./health.mjs";
import { processExecution } from "./processor.mjs";

const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;
let lastHealthCheck = 0;
let lastHealthPrune = 0;
const workerStartedAt = new Date();
let heartbeatTimer = null;
let heartbeatPromise = null;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (heartbeatPromise) return;
    heartbeatPromise = recordWorkerHeartbeat({ workerId, host: os.hostname(), processId: process.pid, startedAt: workerStartedAt })
      .catch((error) => console.error(`[worker:${workerId}] heartbeat falhou`, error))
      .finally(() => { heartbeatPromise = null; });
  }, env.WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

async function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  await heartbeatPromise?.catch(() => null);
  await removeWorkerHeartbeat(workerId).catch(() => null);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    console.log(`[worker:${workerId}] encerramento solicitado por ${signal}`);
  });
}

async function main() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL é obrigatória no worker");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY é obrigatória no worker");

  console.log(`[worker:${workerId}] iniciado`);
  await recordWorkerHeartbeat({ workerId, host: os.hostname(), processId: process.pid, startedAt: workerStartedAt });
  await pruneWorkerHeartbeats();
  startHeartbeat();
  await recoverStaleExecutions();

  while (!stopping) {
    if (Date.now() - lastHealthCheck >= env.HEALTH_CHECK_INTERVAL_MS) {
      await checkProjectHealth().catch((error) => console.error(`[worker:${workerId}] monitoramento falhou`, error));
      lastHealthCheck = Date.now();
    }

    if (Date.now() - lastHealthPrune >= 24 * 60 * 60 * 1000) {
      await pruneHealthChecks(env.HEALTH_CHECK_RETENTION_DAYS).catch((error) => console.error(`[worker:${workerId}] retenção de saúde falhou`, error));
      lastHealthPrune = Date.now();
    }

    const executionId = await claimNextExecution(workerId);
    if (!executionId) {
      await delay(env.WORKER_POLL_INTERVAL_MS);
      continue;
    }

    await processExecution(executionId, workerId).catch((error) => console.error(`[worker:${workerId}] execução falhou`, error));
  }

  await stopHeartbeat();
  await db.$disconnect();
  console.log(`[worker:${workerId}] encerrado`);
}

main().catch(async (error) => {
  console.error(`[worker:${workerId}] erro fatal`, error);
  await stopHeartbeat();
  await db.$disconnect().catch(() => null);
  process.exit(1);
});
