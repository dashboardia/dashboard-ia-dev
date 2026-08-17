ALTER TABLE "Project" ADD COLUMN "previewCommand" TEXT;
ALTER TABLE "Project" ADD COLUMN "previewPort" INTEGER;

ALTER TABLE "Demand" ADD COLUMN "visualValidation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Demand" ADD COLUMN "visualPaths" JSONB;
