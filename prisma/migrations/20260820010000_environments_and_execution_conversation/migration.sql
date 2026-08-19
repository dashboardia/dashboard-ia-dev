ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CLIENT';

CREATE TYPE "ExecutionMessageRole" AS ENUM ('USER', 'AGENT', 'SYSTEM');
CREATE TYPE "DevEnvironmentStatus" AS ENUM ('QUEUED', 'BUILDING', 'DEPLOYING', 'READY', 'FAILED', 'STOPPING', 'EXPIRED');

ALTER TABLE "Execution"
  ADD COLUMN "conversationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastInteractionAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedReason" TEXT,
  ADD COLUMN "adjustmentCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ExecutionMessage" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "authorId" TEXT,
  "role" "ExecutionMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DevEnvironment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "branchName" TEXT NOT NULL,
  "status" "DevEnvironmentStatus" NOT NULL DEFAULT 'QUEUED',
  "provider" TEXT NOT NULL DEFAULT 'DASHBOARDIA',
  "externalId" TEXT,
  "url" TEXT,
  "runtime" TEXT,
  "imageReference" TEXT,
  "port" INTEGER,
  "creditCost" INTEGER NOT NULL DEFAULT 0,
  "creditCharge" JSONB,
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "stoppedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DevEnvironment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GlobalSettings"
  ADD COLUMN "environmentTtlMinutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN "environmentCreditCost" INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN "environmentMaxPerUser" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "executionConversationTimeoutMinutes" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "executionConversationMaxAdjustments" INTEGER NOT NULL DEFAULT 10;

CREATE INDEX "ExecutionMessage_executionId_createdAt_idx" ON "ExecutionMessage"("executionId", "createdAt");
CREATE UNIQUE INDEX "DevEnvironment_externalId_key" ON "DevEnvironment"("externalId");
CREATE INDEX "DevEnvironment_projectId_status_idx" ON "DevEnvironment"("projectId", "status");
CREATE INDEX "DevEnvironment_status_expiresAt_idx" ON "DevEnvironment"("status", "expiresAt");
CREATE INDEX "DevEnvironment_requestedById_createdAt_idx" ON "DevEnvironment"("requestedById", "createdAt");

ALTER TABLE "ExecutionMessage" ADD CONSTRAINT "ExecutionMessage_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutionMessage" ADD CONSTRAINT "ExecutionMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DevEnvironment" ADD CONSTRAINT "DevEnvironment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevEnvironment" ADD CONSTRAINT "DevEnvironment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
