-- AlterTable
ALTER TABLE "Project"
ADD COLUMN "workingDirectory" TEXT NOT NULL DEFAULT '.',
ADD COLUMN "installCommand" TEXT,
ADD COLUMN "lintCommand" TEXT,
ADD COLUMN "testCommand" TEXT,
ADD COLUMN "buildCommand" TEXT;
