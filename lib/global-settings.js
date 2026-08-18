import { db } from "./db.js";

export const defaultGlobalSettings = {
  id: "global",
  timeZone: "America/Sao_Paulo",
  nodeMemoryMb: 384,
  commandTimeoutMinutes: 10,
  agentTimeoutMinutes: 5,
  parallelExecutions: 2,
  financialShadowEnabled: true,
  usdToBrlCents: 600,
  aiSafetyPercent: 15,
  targetGrossMarginPercent: 80,
  creditValueCents: 10,
  reservationBufferPercent: 20,
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
