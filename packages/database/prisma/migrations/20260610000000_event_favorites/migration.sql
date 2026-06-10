CREATE TABLE "EventFavorite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventFavorite_eventId_userId_key" ON "EventFavorite"("eventId", "userId");

CREATE INDEX "EventFavorite_userId_idx" ON "EventFavorite"("userId");

CREATE INDEX "EventFavorite_eventId_idx" ON "EventFavorite"("eventId");

ALTER TABLE "EventFavorite" ADD CONSTRAINT "EventFavorite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventFavorite" ADD CONSTRAINT "EventFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
