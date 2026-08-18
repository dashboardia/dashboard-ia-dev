import { db } from "./db.js";

export const defaultGlobalSettings = {
  id: "global",
  timeZone: "America/Sao_Paulo",
  nodeMemoryMb: 384,
  commandTimeoutMinutes: 10,
  agentTimeoutMinutes: 5,
  parallelExecutions: 2,
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
