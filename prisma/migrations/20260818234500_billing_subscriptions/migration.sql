CREATE TYPE "BillingPlan" AS ENUM ('TRIAL', 'STUDIO', 'AGENCY', 'CUSTOM');
CREATE TYPE "BillingStatus" AS ENUM ('TRIALING', 'PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE "CreditBucketType" AS ENUM ('TRIAL', 'MONTHLY', 'ADDITIONAL', 'ADJUSTMENT');
CREATE TYPE "CreditTransactionType" AS ENUM ('GRANT', 'RESERVE', 'RELEASE', 'CONSUME', 'EXPIRE', 'ADJUSTMENT');
CREATE TYPE "CreditReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');
CREATE TYPE "BillingCheckoutKind" AS ENUM ('PLAN', 'CREDIT_PACK');
CREATE TYPE "BillingCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED', 'EXPIRED', 'FAILED');

CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "trialIdentity" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL DEFAULT 'TRIAL',
    "pendingPlan" "BillingPlan",
    "status" "BillingStatus" NOT NULL DEFAULT 'TRIALING',
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cycleStartedAt" TIMESTAMP(3),
    "cycleEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT DEFAULT 'ASAAS',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "creditDebt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditBucket" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "CreditBucketType" NOT NULL,
    "granted" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditBucket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingTrialOrganization" (
    "id" TEXT NOT NULL,
    "githubOwner" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingTrialOrganization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bucketId" TEXT,
    "executionId" TEXT,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutionCreditReservation" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "CreditReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedCredits" INTEGER NOT NULL,
    "consumedCredits" INTEGER NOT NULL DEFAULT 0,
    "uncoveredCredits" INTEGER NOT NULL DEFAULT 0,
    "allocations" JSONB NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExecutionCreditReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingCheckout" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "BillingCheckoutKind" NOT NULL,
    "targetPlan" "BillingPlan",
    "creditAmount" INTEGER,
    "amountCents" INTEGER NOT NULL,
    "status" "BillingCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "providerCheckoutId" TEXT,
    "providerLink" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingAccount_ownerUserId_key" ON "BillingAccount"("ownerUserId");
CREATE UNIQUE INDEX "BillingAccount_trialIdentity_key" ON "BillingAccount"("trialIdentity");
CREATE UNIQUE INDEX "BillingAccount_providerCustomerId_key" ON "BillingAccount"("providerCustomerId");
CREATE UNIQUE INDEX "BillingAccount_providerSubscriptionId_key" ON "BillingAccount"("providerSubscriptionId");
CREATE INDEX "BillingAccount_status_plan_idx" ON "BillingAccount"("status", "plan");
CREATE UNIQUE INDEX "BillingTrialOrganization_githubOwner_key" ON "BillingTrialOrganization"("githubOwner");
CREATE INDEX "BillingTrialOrganization_accountId_idx" ON "BillingTrialOrganization"("accountId");
CREATE UNIQUE INDEX "CreditBucket_sourceRef_key" ON "CreditBucket"("sourceRef");
CREATE INDEX "CreditBucket_accountId_expiresAt_idx" ON "CreditBucket"("accountId", "expiresAt");
CREATE INDEX "CreditTransaction_accountId_createdAt_idx" ON "CreditTransaction"("accountId", "createdAt");
CREATE INDEX "CreditTransaction_executionId_idx" ON "CreditTransaction"("executionId");
CREATE UNIQUE INDEX "ExecutionCreditReservation_executionId_key" ON "ExecutionCreditReservation"("executionId");
CREATE INDEX "ExecutionCreditReservation_accountId_status_idx" ON "ExecutionCreditReservation"("accountId", "status");
CREATE UNIQUE INDEX "BillingCheckout_providerCheckoutId_key" ON "BillingCheckout"("providerCheckoutId");
CREATE INDEX "BillingCheckout_accountId_status_idx" ON "BillingCheckout"("accountId", "status");
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_providerEventId_key" ON "BillingWebhookEvent"("provider", "providerEventId");
CREATE INDEX "BillingWebhookEvent_processedAt_createdAt_idx" ON "BillingWebhookEvent"("processedAt", "createdAt");

ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingTrialOrganization" ADD CONSTRAINT "BillingTrialOrganization_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditBucket" ADD CONSTRAINT "CreditBucket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "CreditBucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExecutionCreditReservation" ADD CONSTRAINT "ExecutionCreditReservation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutionCreditReservation" ADD CONSTRAINT "ExecutionCreditReservation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
