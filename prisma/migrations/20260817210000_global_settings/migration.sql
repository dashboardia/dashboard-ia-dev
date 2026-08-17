CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "nodeMemoryMb" INTEGER NOT NULL DEFAULT 384,
    "commandTimeoutMinutes" INTEGER NOT NULL DEFAULT 10,
    "agentTimeoutMinutes" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("id")
);
