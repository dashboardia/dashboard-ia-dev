CREATE TABLE "BillingCreditPackCatalog" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "validityMonths" INTEGER NOT NULL DEFAULT 12,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "public" BOOLEAN NOT NULL DEFAULT true,
  "structural" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCreditPackCatalog_pkey" PRIMARY KEY ("code")
);

INSERT INTO "BillingCreditPackCatalog" (
  "code", "name", "credits", "priceCents", "validityMonths", "active", "public", "structural", "sortOrder"
) VALUES
  ('CREDITS_1000', '1.000 créditos', 1000, 10000, 12, true, true, true, 10),
  ('CREDITS_3000', '3.000 créditos', 3000, 30000, 12, true, true, true, 20),
  ('CREDITS_7000', '7.000 créditos', 7000, 70000, 12, true, true, true, 30);

CREATE INDEX "BillingCreditPackCatalog_active_public_sortOrder_idx"
ON "BillingCreditPackCatalog"("active", "public", "sortOrder");

ALTER TABLE "BillingCheckout"
ADD COLUMN "creditValidityMonths" INTEGER;
