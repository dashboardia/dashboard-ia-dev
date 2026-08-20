ALTER TABLE "GlobalSettings"
ADD COLUMN "workerAutoscalingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "workerMinReplicas" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "workerMaxReplicas" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "workerAutoscaleIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "workerScaleDownCooldownMinutes" INTEGER NOT NULL DEFAULT 5;

CREATE TABLE "WorkerAutoscalerState" (
    "id" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "currentReplicas" INTEGER,
    "desiredReplicas" INTEGER,
    "queuedExecutions" INTEGER NOT NULL DEFAULT 0,
    "activeExecutions" INTEGER NOT NULL DEFAULT 0,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastScaledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerAutoscalerState_pkey" PRIMARY KEY ("id")
);
