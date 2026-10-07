-- CreateEnum
CREATE TYPE "AssistantThreadStatus" AS ENUM ('IDLE', 'RUNNING', 'WAITING_APPROVAL');

-- CreateEnum
CREATE TYPE "AssistantMessageKind" AS ENUM ('USER', 'ASSISTANT', 'TOOL_RESULTS');

-- CreateEnum
CREATE TYPE "AssistantToolCallStatus" AS ENUM ('PENDING', 'WAITING_APPROVAL', 'DONE', 'ERROR', 'REJECTED');

-- CreateTable
CREATE TABLE "AssistantThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "status" "AssistantThreadStatus" NOT NULL DEFAULT 'IDLE',
    "pendingUsageId" TEXT,
    "stopCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "AssistantMessageKind" NOT NULL,
    "text" TEXT,
    "content" JSONB NOT NULL,
    "aiUsageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantToolCall" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "toolUseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "AssistantToolCallStatus" NOT NULL DEFAULT 'PENDING',
    "preview" JSONB,
    "output" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantThread_pendingUsageId_key" ON "AssistantThread"("pendingUsageId");

-- CreateIndex
CREATE INDEX "AssistantThread_workspaceId_userId_createdAt_idx" ON "AssistantThread"("workspaceId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantMessage_aiUsageId_key" ON "AssistantMessage"("aiUsageId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantMessage_threadId_seq_key" ON "AssistantMessage"("threadId", "seq");

-- CreateIndex
CREATE INDEX "AssistantToolCall_messageId_idx" ON "AssistantToolCall"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantToolCall_threadId_toolUseId_key" ON "AssistantToolCall"("threadId", "toolUseId");

-- AddForeignKey
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_aiUsageId_fkey" FOREIGN KEY ("aiUsageId") REFERENCES "AiUsage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantToolCall" ADD CONSTRAINT "AssistantToolCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantToolCall" ADD CONSTRAINT "AssistantToolCall_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
