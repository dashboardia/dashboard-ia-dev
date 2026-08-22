import os from "node:os";
import process from "node:process";

import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { claimNextExecution, expireInactiveExecutionConversations, recoverStaleExecutions, reopenFailedExecutionForCorrection } from "../lib/executions.js";
import { syncActiveDevEnvironments } from "../lib/dev-environments.js";
import { getGlobalSettings } from "../lib/global-settings.js";
import { pruneWorkerHeartbeats, recordWorkerHeartbeat, removeWorkerHeartbeat } from "../lib/worker-heartbeat.js";
import { checkProjectHealth, pruneHealthChecks } from "./health.mjs";
import { processExecution } from "./processor.mjs";
import { evaluateWorkerAutoscaling } from "./autoscaler.mjs";
import { requestExecutionPreviewAutomation, syncExecutionPreviewAutomations } from "./execution-preview-automation.mjs";

const workerId = `${process.env.RAILWAY_REPLICA_ID || os.hostname()}:${process.pid}`;
const LOCAL_CONCURRENCY_LIMIT = 1;
let stopping = false;
let lastHealthCheck = 0;
let lastHealthPrune = 0;
let lastStaleRecovery = 0;
let lastConversationExpiration = 0;
let lastAutoscaleEvaluation = 0;
let lastEnvironmentSynchronization = 0;
let lastExecutionPreviewSynchronization = 0;
const workerStartedAt = new Date();
let heartbeatTimer = null;
let heartbeatPromise = null;
let globalConcurrencyLimit = 2;
let processingEnabled = true;
let lastConcurrencyRefresh = 0;
let runtimeSettings = null;
const activeExecutions = new Set();
const activePreviewRequests = new Set();

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

async function refreshConcurrencyLimit() {
  if (Date.now() - lastConcurrencyRefresh < 5_000) return;
  const settings = await getGlobalSettings();
  runtimeSettings = settings;
  const nextLimit = Math.max(1, Math.trunc(settings.workerAutoscalingEnabled ? settings.workerMaxReplicas : settings.parallelExecutions));
  if (nextLimit !== globalConcurrencyLimit || settings.executionProcessingEnabled !== processingEnabled) {
    globalConcurrencyLimit = nextLimit;
    processingEnabled = settings.executionProcessingEnabled;
    console.log(`[worker:${workerId}] ${processingEnabled ? `capacidade global atualizada para ${globalConcurrencyLimit}; uma execução por réplica` : "processamento global pausado"}`);
  }
  lastConcurrencyRefresh = Date.now();
}

function startExecutionPreview(executionId) {
  const task = requestExecutionPreviewAutomation(executionId, db, { settings: runtimeSettings })
    .catch((error) => console.error(`[worker:${workerId}] ambiente automático da execução ${executionId} falhou ao iniciar`, error))
    .finally(() => activePreviewRequests.delete(task));
  activePreviewRequests.add(task);
}

function startExecution(executionId) {
  const task = processExecution(executionId, workerId)
    .then(() => startExecutionPreview(executionId))
    .catch(async (error) => {
      console.error(`[worker:${workerId}] execução falhou`, error);
      try {
        const reopened = await reopenFailedExecutionForCorrection(executionId, db, {
          timeoutMinutes: runtimeSettings?.executionConversationTimeoutMinutes ?? 24 * 60,
        });
        if (reopened) console.log(`[worker:${workerId}] execução ${executionId} mantida aberta para correção pelo cliente`);
      } catch (recoveryError) {
        console.error(`[worker:${workerId}] não foi possível manter a execução aberta para correção`, recoveryError);
      }
    })
    .finally(() => activeExecutions.delete(task));
  activeExecutions.add(task);
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
  await refreshConcurrencyLimit();
  await recoverStaleExecutions(db, {
    staleMinutes: runtimeSettings.staleExecutionMinutes,
    maxAttempts: runtimeSettings.executionMaxAttempts,
  });

  while (!stopping) {
    await refreshConcurrencyLimit().catch((error) => console.error(`[worker:${workerId}] configuração de concorrência falhou`, error));
    if (Date.now() - lastStaleRecovery >= 60_000) {
      await recoverStaleExecutions(db, {
        staleMinutes: runtimeSettings.staleExecutionMinutes,
        maxAttempts: runtimeSettings.executionMaxAttempts,
      }).catch((error) => console.error(`[worker:${workerId}] recuperação de execuções travadas falhou`, error));
      lastStaleRecovery = Date.now();
    }
    if (Date.now() - lastConversationExpiration >= 60_000) {
      await expireInactiveExecutionConversations(db).catch((error) => console.error(`[worker:${workerId}] expiração de conversas falhou`, error));
      lastConversationExpiration = Date.now();
    }
    if (Date.now() - lastExecutionPreviewSynchronization >= 5_000) {
      await syncExecutionPreviewAutomations(db, { settings: runtimeSettings })
        .catch((error) => console.error(`[worker:${workerId}] automação dos ambientes de execução falhou`, error));
      lastExecutionPreviewSynchronization = Date.now();
    }
    if (Date.now() - lastEnvironmentSynchronization >= 30_000) {
      await syncActiveDevEnvironments(db).catch((error) => console.error(`[worker:${workerId}] sincronização de ambientes falhou`, error));
      lastEnvironmentSynchronization = Date.now();
    }
    if (runtimeSettings.workerAutoscalingEnabled && Date.now() - lastAutoscaleEvaluation >= runtimeSettings.workerAutoscaleIntervalSeconds * 1_000) {
      const autoscaling = await evaluateWorkerAutoscaling({
        workerId,
        settings: runtimeSettings,
        configuration: env,
      }).catch((error) => {
        console.error(`[worker:${workerId}] autoscaling falhou`, error);
        return null;
      });
      if (autoscaling?.status === "SCALED") {
        console.log(`[worker:${workerId}] replicas ${autoscaling.previousReplicas} -> ${autoscaling.currentReplicas}; fila=${autoscaling.queuedExecutions}; ativas=${autoscaling.activeExecutions}`);
      }
      lastAutoscaleEvaluation = Date.now();
    }
    if (Date.now() - lastHealthCheck >= runtimeSettings.healthCheckIntervalMinutes * 60_000) {
      await checkProjectHealth({
        concurrency: runtimeSettings.healthCheckConcurrency,
        timeoutMs: runtimeSettings.healthCheckTimeoutSeconds * 1_000,
      }).catch((error) => console.error(`[worker:${workerId}] monitoramento falhou`, error));
      lastHealthCheck = Date.now();
    }

    if (Date.now() - lastHealthPrune >= 24 * 60 * 60 * 1000) {
      await pruneHealthChecks(runtimeSettings.healthCheckRetentionDays).catch((error) => console.error(`[worker:${workerId}] retenção de saúde falhou`, error));
      lastHealthPrune = Date.now();
    }

    while (!stopping && processingEnabled && activeExecutions.size < LOCAL_CONCURRENCY_LIMIT) {
      const executionId = await claimNextExecution(workerId, db, {
        maxAttempts: runtimeSettings.executionMaxAttempts,
        globalConcurrencyLimit,
        processingEnabled,
      });
      if (!executionId) break;
      startExecution(executionId);
    }
    await delay(env.WORKER_POLL_INTERVAL_MS);
  }

  if (activeExecutions.size || activePreviewRequests.size) {
    console.log(`[worker:${workerId}] aguardando ${activeExecutions.size} execução(ões) e ${activePreviewRequests.size} publicação(ões) de ambiente ativas`);
    await Promise.allSettled([...activeExecutions, ...activePreviewRequests]);
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
