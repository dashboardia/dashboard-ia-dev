-- Parâmetros internos usados apenas para simulação; nenhum crédito é cobrado.
ALTER TABLE "GlobalSettings"
ADD COLUMN "financialShadowEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "usdToBrlCents" INTEGER NOT NULL DEFAULT 600,
ADD COLUMN "aiSafetyPercent" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "targetGrossMarginPercent" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN "creditValueCents" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "reservationBufferPercent" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN "workerCostCentsPerHour" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "visualValidationCostCents" INTEGER NOT NULL DEFAULT 10;

CREATE TABLE "ExecutionFinancialSnapshot" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SHADOW',
    "formulaVersion" TEXT NOT NULL,
    "calculationStatus" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "inputPriceUsdMicrosPerMillion" INTEGER NOT NULL,
    "outputPriceUsdMicrosPerMillion" INTEGER NOT NULL,
    "aiCostUsdMicros" INTEGER NOT NULL,
    "usdToBrlCents" INTEGER NOT NULL,
    "aiSafetyPercent" INTEGER NOT NULL,
    "adjustedAiCostBrlCents" INTEGER NOT NULL,
    "workerDurationSeconds" INTEGER NOT NULL,
    "workerCostBrlCents" INTEGER NOT NULL,
    "visualValidationCostBrlCents" INTEGER NOT NULL,
    "totalInternalCostBrlCents" INTEGER NOT NULL,
    "simulatedReservedCredits" INTEGER NOT NULL,
    "simulatedConsumedCredits" INTEGER NOT NULL,
    "simulatedCommercialValueBrlCents" INTEGER NOT NULL,
    "estimatedGrossMarginBasisPoints" INTEGER NOT NULL,
    "targetGrossMarginPercent" INTEGER NOT NULL,
    "wouldCharge" BOOLEAN NOT NULL DEFAULT false,
    "pricingMetadata" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionFinancialSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExecutionFinancialSnapshot_executionId_key" ON "ExecutionFinancialSnapshot"("executionId");
CREATE INDEX "ExecutionFinancialSnapshot_calculatedAt_idx" ON "ExecutionFinancialSnapshot"("calculatedAt");
CREATE INDEX "ExecutionFinancialSnapshot_mode_calculationStatus_idx" ON "ExecutionFinancialSnapshot"("mode", "calculationStatus");

ALTER TABLE "ExecutionFinancialSnapshot" ADD CONSTRAINT "ExecutionFinancialSnapshot_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
