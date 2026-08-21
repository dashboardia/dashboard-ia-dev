ALTER TABLE "Demand"
  ADD COLUMN "baseBranch" TEXT;

UPDATE "Demand" AS demand
SET "baseBranch" = project."defaultBranch"
FROM "Project" AS project
WHERE demand."projectId" = project."id";

UPDATE "Demand"
SET "baseBranch" = 'main'
WHERE "baseBranch" IS NULL OR BTRIM("baseBranch") = '';

ALTER TABLE "Demand"
  ALTER COLUMN "baseBranch" SET NOT NULL,
  ALTER COLUMN "baseBranch" SET DEFAULT 'main';
