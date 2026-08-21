ALTER TABLE "DevEnvironment"
  ADD COLUMN "creditChargedAt" TIMESTAMP(3);

ALTER TABLE "GlobalSettings"
  ALTER COLUMN "environmentCreditCost" SET DEFAULT 30;

UPDATE "GlobalSettings"
SET "environmentCreditCost" = 30
WHERE "id" = 'global';
