-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('PUSH', 'SMS', 'ALIMTALK');

-- CreateEnum
CREATE TYPE "ReminderAudience" AS ENUM ('CREATOR', 'ATTENDEES');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "EventReminder" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "audience" "ReminderAudience" NOT NULL DEFAULT 'CREATOR',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "toPhone" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "relayMsgId" TEXT,
    "failCode" TEXT,
    "fallback" TEXT,
    "debitLedgerId" BIGINT,
    "refundLedgerId" BIGINT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "resultAt" TIMESTAMP(3),

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayEvent" (
    "id" BIGSERIAL NOT NULL,
    "deliveryId" TEXT,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventReminder_eventId_minutesBefore_channel_key" ON "EventReminder"("eventId", "minutesBefore", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_relayMsgId_key" ON "ReminderDelivery"("relayMsgId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_debitLedgerId_key" ON "ReminderDelivery"("debitLedgerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_refundLedgerId_key" ON "ReminderDelivery"("refundLedgerId");

-- CreateIndex
CREATE INDEX "ReminderDelivery_status_sentAt_idx" ON "ReminderDelivery"("status", "sentAt");

-- CreateIndex
CREATE INDEX "ReminderDelivery_workspaceId_queuedAt_idx" ON "ReminderDelivery"("workspaceId", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_reminderId_userId_fireAt_key" ON "ReminderDelivery"("reminderId", "userId", "fireAt");

-- CreateIndex
CREATE UNIQUE INDEX "RelayEvent_eventId_key" ON "RelayEvent"("eventId");

-- CreateIndex
CREATE INDEX "RelayEvent_deliveryId_idx" ON "RelayEvent"("deliveryId");

-- AddForeignKey
ALTER TABLE "EventReminder" ADD CONSTRAINT "EventReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminder" ADD CONSTRAINT "EventReminder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "EventReminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_debitLedgerId_fkey" FOREIGN KEY ("debitLedgerId") REFERENCES "CreditLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_refundLedgerId_fkey" FOREIGN KEY ("refundLedgerId") REFERENCES "CreditLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelayEvent" ADD CONSTRAINT "RelayEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ReminderDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
