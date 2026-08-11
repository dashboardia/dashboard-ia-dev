-- AlterTable
ALTER TABLE "Project"
ADD COLUMN "githubWebhookId" TEXT,
ADD COLUMN "githubWebhookAt" TIMESTAMP(3),
ADD COLUMN "githubWebhookError" TEXT;
