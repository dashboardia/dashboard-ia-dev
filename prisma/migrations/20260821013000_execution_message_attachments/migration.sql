CREATE TABLE "ExecutionMessageAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionMessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExecutionMessageAttachment_storageKey_key"
  ON "ExecutionMessageAttachment"("storageKey");

CREATE INDEX "ExecutionMessageAttachment_messageId_idx"
  ON "ExecutionMessageAttachment"("messageId");

ALTER TABLE "ExecutionMessageAttachment"
  ADD CONSTRAINT "ExecutionMessageAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ExecutionMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "GlobalSettings"
SET "executionConversationTimeoutMinutes" = 1440
WHERE "executionConversationTimeoutMinutes" < 1440;

UPDATE "Execution"
SET "conversationExpiresAt" = "lastInteractionAt" + INTERVAL '24 hours'
WHERE "status" = 'AWAITING_CLIENT'
  AND "lastInteractionAt" IS NOT NULL
  AND ("conversationExpiresAt" IS NULL OR "conversationExpiresAt" < "lastInteractionAt" + INTERVAL '24 hours');
