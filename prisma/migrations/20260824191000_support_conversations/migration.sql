CREATE TYPE "SupportMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "SupportConversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activeKey" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "closeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" "SupportMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportMessageAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportConversation_activeKey_key" ON "SupportConversation"("activeKey");
CREATE INDEX "SupportConversation_userId_closedAt_expiresAt_idx" ON "SupportConversation"("userId", "closedAt", "expiresAt");
CREATE INDEX "SupportConversation_lastMessageAt_idx" ON "SupportConversation"("lastMessageAt");
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");
CREATE UNIQUE INDEX "SupportMessageAttachment_storageKey_key" ON "SupportMessageAttachment"("storageKey");
CREATE INDEX "SupportMessageAttachment_messageId_idx" ON "SupportMessageAttachment"("messageId");

ALTER TABLE "SupportConversation"
  ADD CONSTRAINT "SupportConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportMessage"
  ADD CONSTRAINT "SupportMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportMessageAttachment"
  ADD CONSTRAINT "SupportMessageAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
