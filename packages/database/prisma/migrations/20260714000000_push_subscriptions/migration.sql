CREATE TYPE "PushProvider" AS ENUM ('NOOP', 'WEB_PUSH', 'EXPO', 'FCM', 'APNS');

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PushProvider" NOT NULL DEFAULT 'NOOP',
    "endpoint" TEXT NOT NULL,
    "externalId" TEXT,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "platform" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushNotificationDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" "PushProvider" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_provider_endpoint_key" ON "PushSubscription"("provider", "endpoint");

CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE INDEX "PushSubscription_provider_enabled_idx" ON "PushSubscription"("provider", "enabled");

CREATE INDEX "PushNotificationDelivery_userId_createdAt_idx" ON "PushNotificationDelivery"("userId", "createdAt");

CREATE INDEX "PushNotificationDelivery_subscriptionId_idx" ON "PushNotificationDelivery"("subscriptionId");

CREATE INDEX "PushNotificationDelivery_provider_status_idx" ON "PushNotificationDelivery"("provider", "status");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushNotificationDelivery" ADD CONSTRAINT "PushNotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushNotificationDelivery" ADD CONSTRAINT "PushNotificationDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
