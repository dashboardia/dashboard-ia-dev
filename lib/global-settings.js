import { db } from "./db.js";

export const defaultGlobalSettings = {
  id: "global",
  timeZone: "America/Sao_Paulo",
  nodeMemoryMb: 384,
  commandTimeoutMinutes: 10,
  agentTimeoutMinutes: 5,
  parallelExecutions: 2,
  workerAutoscalingEnabled: true,
  workerMinReplicas: 2,
  workerMaxReplicas: 10,
  workerAutoscaleIntervalSeconds: 60,
  workerScaleDownCooldownMinutes: 5,
  executionProcessingEnabled: true,
  agentPowerMode: "BALANCED",
  executionMaxAttempts: 3,
  staleExecutionMinutes: 30,
  healthCheckIntervalMinutes: 5,
  healthCheckTimeoutSeconds: 10,
  healthCheckConcurrency: 10,
  healthCheckRetentionDays: 30,
  previewPreparationTimeoutMinutes: 15,
  environmentTtlMinutes: 240,
  environmentCreditCost: 300,
  environmentMaxPerUser: 2,
  executionConversationTimeoutMinutes: 180,
  executionConversationMaxAdjustments: 10,
  financialShadowEnabled: true,
  usdToBrlCents: 600,
  aiSafetyPercent: 15,
  targetGrossMarginPercent: 80,
  creditValueCents: 10,
  reservationBufferPercent: 20,
  creditBalanceSafetyMarginPercent: 20,
  workerCostCentsPerHour: 100,
  visualValidationCostCents: 10,
};

export async function getGlobalSettings(database = db) {
  if (!database.globalSettings) return defaultGlobalSettings;
  return database.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: defaultGlobalSettings,
  });
}

export function formatDateTime(value, timeZone = defaultGlobalSettings.timeZone) {
  return value.toLocaleString("pt-BR", { timeZone });
}
