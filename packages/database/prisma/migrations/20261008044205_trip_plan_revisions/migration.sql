-- CreateEnum
CREATE TYPE "TripRevisionStatus" AS ENUM ('PENDING', 'PROPOSED', 'ACCEPTED', 'DISCARDED', 'FAILED');

-- DropIndex
DROP INDEX "DocumentChunk_embedding_idx";

-- DropIndex
DROP INDEX "EventEmbedding_embedding_idx";

-- CreateTable
CREATE TABLE "TripPlanRevision" (
    "id" TEXT NOT NULL,
    "tripPlanId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "baseDraft" JSONB NOT NULL,
    "proposedDraft" JSONB,
    "status" "TripRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "aiUsageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "TripPlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripPlanRevision_aiUsageId_key" ON "TripPlanRevision"("aiUsageId");

-- CreateIndex
CREATE INDEX "TripPlanRevision_tripPlanId_createdAt_idx" ON "TripPlanRevision"("tripPlanId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripPlanRevision_tripPlanId_requestKey_key" ON "TripPlanRevision"("tripPlanId", "requestKey");

-- AddForeignKey
ALTER TABLE "TripPlanRevision" ADD CONSTRAINT "TripPlanRevision_tripPlanId_fkey" FOREIGN KEY ("tripPlanId") REFERENCES "TripPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlanRevision" ADD CONSTRAINT "TripPlanRevision_aiUsageId_fkey" FOREIGN KEY ("aiUsageId") REFERENCES "AiUsage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
