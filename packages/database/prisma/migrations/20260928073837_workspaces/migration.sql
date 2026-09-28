-- Every calendar now belongs to a workspace (the billing unit).
-- Existing data: each user gets a PERSONAL workspace + credit account, and each calendar
-- moves into its OWNER's personal workspace. workspaceId becomes NOT NULL at the end.

-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'TEAM');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- AlterTable (nullable until backfilled below)
ALTER TABLE "Calendar" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL DEFAULT 'TEAM',
    "personalOwnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_personalOwnerId_key" ON "Workspace"("personalOwnerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_workspaceId_key" ON "CreditAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "Calendar_workspaceId_idx" ON "Calendar"("workspaceId");

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_personalOwnerId_fkey" FOREIGN KEY ("personalOwnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one PERSONAL workspace (+ OWNER membership + credit account) per existing user
INSERT INTO "Workspace" ("id", "name", "type", "personalOwnerId", "updatedAt")
SELECT gen_random_uuid()::text, '개인 워크스페이스', 'PERSONAL', u."id", CURRENT_TIMESTAMP
FROM "User" u;

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role")
SELECT gen_random_uuid()::text, w."id", w."personalOwnerId", 'OWNER'
FROM "Workspace" w
WHERE w."type" = 'PERSONAL';

INSERT INTO "CreditAccount" ("id", "workspaceId", "updatedAt")
SELECT gen_random_uuid()::text, w."id", CURRENT_TIMESTAMP
FROM "Workspace" w;

-- Backfill: each calendar -> its OWNER's personal workspace (earliest OWNER if several)
UPDATE "Calendar" c
SET "workspaceId" = (
  SELECT w."id"
  FROM "CalendarMember" m
  JOIN "Workspace" w ON w."personalOwnerId" = m."userId"
  WHERE m."calendarId" = c."id" AND m."role" = 'OWNER'
  ORDER BY m."joinedAt"
  LIMIT 1
);

-- Fails loudly if any calendar had no OWNER to inherit a workspace from.
ALTER TABLE "Calendar" ALTER COLUMN "workspaceId" SET NOT NULL;
