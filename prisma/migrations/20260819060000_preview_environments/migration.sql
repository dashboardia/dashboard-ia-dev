CREATE TYPE "PreviewEnvironmentStatus" AS ENUM (
  'QUEUED',
  'BUILDING',
  'DEPLOYING',
  'READY',
  'FAILED',
  'STOPPING',
  'EXPIRED'
);

CREATE TABLE "PreviewEnvironment" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "status" "PreviewEnvironmentStatus" NOT NULL DEFAULT 'QUEUED',
  "provider" TEXT NOT NULL DEFAULT 'DASHBOARDIA',
  "externalId" TEXT,
  "url" TEXT,
  "runtime" TEXT,
  "imageReference" TEXT,
  "port" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "stoppedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PreviewEnvironment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreviewEnvironment_executionId_key" ON "PreviewEnvironment"("executionId");
CREATE UNIQUE INDEX "PreviewEnvironment_externalId_key" ON "PreviewEnvironment"("externalId");
CREATE INDEX "PreviewEnvironment_status_expiresAt_idx" ON "PreviewEnvironment"("status", "expiresAt");
CREATE INDEX "PreviewEnvironment_provider_externalId_idx" ON "PreviewEnvironment"("provider", "externalId");

ALTER TABLE "PreviewEnvironment"
ADD CONSTRAINT "PreviewEnvironment_executionId_fkey"
FOREIGN KEY ("executionId") REFERENCES "Execution"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
