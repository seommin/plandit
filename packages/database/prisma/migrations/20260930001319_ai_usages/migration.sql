-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('SCHEDULE_ASSISTANT', 'MEMORY_SEARCH', 'TRIP_PLANNER');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('RESERVED', 'CALLING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "status" "AiUsageStatus" NOT NULL DEFAULT 'RESERVED',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "maxOutputTokens" INTEGER NOT NULL,
    "estimatedCredits" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteInputTokens" INTEGER NOT NULL DEFAULT 0,
    "attempts" JSONB,
    "failureCode" TEXT,
    "latencyMs" INTEGER,
    "debitLedgerId" BIGINT,
    "adjustLedgerId" BIGINT,
    "refundLedgerId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_debitLedgerId_key" ON "AiUsage"("debitLedgerId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_adjustLedgerId_key" ON "AiUsage"("adjustLedgerId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_refundLedgerId_key" ON "AiUsage"("refundLedgerId");

-- CreateIndex
CREATE INDEX "AiUsage_workspaceId_createdAt_idx" ON "AiUsage"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_status_createdAt_idx" ON "AiUsage"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_debitLedgerId_fkey" FOREIGN KEY ("debitLedgerId") REFERENCES "CreditLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_adjustLedgerId_fkey" FOREIGN KEY ("adjustLedgerId") REFERENCES "CreditLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_refundLedgerId_fkey" FOREIGN KEY ("refundLedgerId") REFERENCES "CreditLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
