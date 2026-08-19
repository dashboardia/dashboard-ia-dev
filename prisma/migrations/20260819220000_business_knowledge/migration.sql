CREATE TYPE "BusinessKnowledgeStatus" AS ENUM ('CANDIDATE', 'APPROVED', 'REJECTED');

CREATE TYPE "BusinessKnowledgeSource" AS ENUM ('MANUAL', 'DEMAND', 'REVIEW', 'DOCUMENT', 'SYSTEM');

CREATE TABLE "BusinessKnowledge" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT,
    "status" "BusinessKnowledgeStatus" NOT NULL DEFAULT 'CANDIDATE',
    "source" "BusinessKnowledgeSource" NOT NULL DEFAULT 'MANUAL',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceReference" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessKnowledge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessKnowledge_ownerUserId_status_idx" ON "BusinessKnowledge"("ownerUserId", "status");
CREATE INDEX "BusinessKnowledge_projectId_status_idx" ON "BusinessKnowledge"("projectId", "status");

ALTER TABLE "BusinessKnowledge"
    ADD CONSTRAINT "BusinessKnowledge_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessKnowledge"
    ADD CONSTRAINT "BusinessKnowledge_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessKnowledge"
    ADD CONSTRAINT "BusinessKnowledge_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessKnowledge"
    ADD CONSTRAINT "BusinessKnowledge_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
