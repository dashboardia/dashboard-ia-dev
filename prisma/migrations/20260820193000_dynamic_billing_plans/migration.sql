CREATE TABLE "BillingPlanCatalog" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER,
  "includedCredits" INTEGER,
  "projectLimit" INTEGER,
  "parallelExecutionLimit" INTEGER,
  "trialDays" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "public" BOOLEAN NOT NULL DEFAULT true,
  "structural" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingPlanCatalog_pkey" PRIMARY KEY ("code")
);

INSERT INTO "BillingPlanCatalog" (
  "code", "name", "description", "priceCents", "includedCredits",
  "projectLimit", "parallelExecutionLimit", "trialDays", "active", "public", "structural", "sortOrder"
) VALUES
  ('TRIAL', 'Teste', 'Acesso gratuito para conhecer a plataforma.', 0, 300, 1, 1, 7, true, false, true, 0),
  ('STUDIO', 'Studio', 'Para profissionais e operações menores.', 29700, 3000, 5, 2, NULL, true, true, true, 10),
  ('AGENCY', 'Agência', 'Para operações com mais projetos em paralelo.', 69700, 7000, 20, 5, NULL, true, true, true, 20),
  ('CUSTOM', 'Sob medida', 'Limites personalizados para a administração e contratos especiais.', NULL, NULL, NULL, NULL, NULL, true, false, true, 100)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "BillingAccount" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "BillingAccount" ALTER COLUMN "plan" TYPE TEXT USING ("plan"::text);
ALTER TABLE "BillingAccount" ALTER COLUMN "pendingPlan" TYPE TEXT USING ("pendingPlan"::text);
ALTER TABLE "BillingCheckout" ALTER COLUMN "targetPlan" TYPE TEXT USING ("targetPlan"::text);
ALTER TABLE "BillingAccount" ALTER COLUMN "plan" SET DEFAULT 'TRIAL';

DROP TYPE "BillingPlan";

CREATE INDEX "BillingPlanCatalog_active_public_sortOrder_idx"
ON "BillingPlanCatalog"("active", "public", "sortOrder");

ALTER TABLE "BillingAccount"
ADD CONSTRAINT "BillingAccount_plan_fkey"
FOREIGN KEY ("plan") REFERENCES "BillingPlanCatalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAccount"
ADD CONSTRAINT "BillingAccount_pendingPlan_fkey"
FOREIGN KEY ("pendingPlan") REFERENCES "BillingPlanCatalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingCheckout"
ADD CONSTRAINT "BillingCheckout_targetPlan_fkey"
FOREIGN KEY ("targetPlan") REFERENCES "BillingPlanCatalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
