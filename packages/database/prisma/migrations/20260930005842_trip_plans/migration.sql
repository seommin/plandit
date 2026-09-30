-- CreateEnum
CREATE TYPE "TripPlanStatus" AS ENUM ('GENERATING', 'READY', 'FAILED', 'APPLIED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "tripPlanId" TEXT;

-- CreateTable
CREATE TABLE "TripPlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "draft" JSONB,
    "status" "TripPlanStatus" NOT NULL DEFAULT 'GENERATING',
    "failureCode" TEXT,
    "aiUsageId" TEXT NOT NULL,
    "addedCalendarMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "TripPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripPlan_aiUsageId_key" ON "TripPlan"("aiUsageId");

-- CreateIndex
CREATE INDEX "TripPlan_workspaceId_createdById_createdAt_idx" ON "TripPlan"("workspaceId", "createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripPlan_createdById_requestKey_key" ON "TripPlan"("createdById", "requestKey");

-- CreateIndex
CREATE INDEX "Event_tripPlanId_idx" ON "Event"("tripPlanId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_tripPlanId_fkey" FOREIGN KEY ("tripPlanId") REFERENCES "TripPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlan" ADD CONSTRAINT "TripPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlan" ADD CONSTRAINT "TripPlan_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlan" ADD CONSTRAINT "TripPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlan" ADD CONSTRAINT "TripPlan_aiUsageId_fkey" FOREIGN KEY ("aiUsageId") REFERENCES "AiUsage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
