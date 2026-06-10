-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CalendarRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CalendarType" AS ENUM ('PERSONAL', 'SHARED', 'SUBSCRIBED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PRIVATE', 'CALENDAR', 'PUBLIC_LINK');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "ShareChannel" AS ENUM ('LINK', 'KAKAO', 'NAVER', 'EMAIL');

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'APPLE', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "WidgetSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'LOCK_SCREEN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "locale" TEXT NOT NULL DEFAULT 'ko-KR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CalendarType" NOT NULL DEFAULT 'PERSONAL',
    "color" TEXT NOT NULL DEFAULT '#2F6BFF',
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarMember" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CalendarRole" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarInvite" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "CalendarRole" NOT NULL DEFAULT 'VIEWER',
    "token" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "status" "EventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "visibility" "EventVisibility" NOT NULL DEFAULT 'CALENDAR',
    "color" TEXT,
    "recurrence" JSONB,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventShare" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "channel" "ShareChannel" NOT NULL DEFAULT 'LINK',
    "includeDescription" BOOLEAN NOT NULL DEFAULT true,
    "includeLocation" BOOLEAN NOT NULL DEFAULT true,
    "allowGuestRsvp" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarIntegration" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "externalCalendarId" TEXT NOT NULL,
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calendarId" TEXT,
    "size" "WidgetSize" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL DEFAULT 'Today',
    "showWeather" BOOLEAN NOT NULL DEFAULT false,
    "showTasks" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "CalendarMember_userId_idx" ON "CalendarMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarMember_calendarId_userId_key" ON "CalendarMember"("calendarId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarInvite_token_key" ON "CalendarInvite"("token");

-- CreateIndex
CREATE INDEX "CalendarInvite_email_idx" ON "CalendarInvite"("email");

-- CreateIndex
CREATE INDEX "CalendarInvite_calendarId_idx" ON "CalendarInvite"("calendarId");

-- CreateIndex
CREATE INDEX "Event_calendarId_startsAt_idx" ON "Event"("calendarId", "startsAt");

-- CreateIndex
CREATE INDEX "Event_createdById_idx" ON "Event"("createdById");

-- CreateIndex
CREATE INDEX "Event_visibility_idx" ON "Event"("visibility");

-- CreateIndex
CREATE INDEX "Event_externalId_idx" ON "Event"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "EventShare_slug_key" ON "EventShare"("slug");

-- CreateIndex
CREATE INDEX "EventShare_eventId_idx" ON "EventShare"("eventId");

-- CreateIndex
CREATE INDEX "EventShare_createdById_idx" ON "EventShare"("createdById");

-- CreateIndex
CREATE INDEX "EventShare_channel_idx" ON "EventShare"("channel");

-- CreateIndex
CREATE INDEX "EventAttendee_userId_idx" ON "EventAttendee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendee_eventId_email_key" ON "EventAttendee"("eventId", "email");

-- CreateIndex
CREATE INDEX "CalendarIntegration_calendarId_idx" ON "CalendarIntegration"("calendarId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarIntegration_provider_externalCalendarId_key" ON "CalendarIntegration"("provider", "externalCalendarId");

-- CreateIndex
CREATE INDEX "WidgetPreference_userId_idx" ON "WidgetPreference"("userId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarMember" ADD CONSTRAINT "CalendarMember_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarMember" ADD CONSTRAINT "CalendarMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarInvite" ADD CONSTRAINT "CalendarInvite_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarInvite" ADD CONSTRAINT "CalendarInvite_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventShare" ADD CONSTRAINT "EventShare_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventShare" ADD CONSTRAINT "EventShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarIntegration" ADD CONSTRAINT "CalendarIntegration_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetPreference" ADD CONSTRAINT "WidgetPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetPreference" ADD CONSTRAINT "WidgetPreference_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
