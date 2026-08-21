import { db } from "./db.js";
import { defaultGlobalSettings } from "./global-settings.js";

async function ensureGlobalSettings(database) {
  if (!database.globalSettings) return;
  await database.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: defaultGlobalSettings,
  });
}

export async function getPublicOperationalAccessEnabled(database = db) {
  await ensureGlobalSettings(database);
  const rows = await database.$queryRawUnsafe(
    'SELECT "publicOperationalAccessEnabled" FROM "GlobalSettings" WHERE "id" = $1 LIMIT 1',
    "global",
  );
  return rows?.[0]?.publicOperationalAccessEnabled !== false;
}

export async function setPublicOperationalAccessEnabled(enabled, database = db) {
  await ensureGlobalSettings(database);
  await database.$executeRawUnsafe(
    'UPDATE "GlobalSettings" SET "publicOperationalAccessEnabled" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2',
    Boolean(enabled),
    "global",
  );
  return getPublicOperationalAccessEnabled(database);
}
