import { prisma } from "@plandit/database/prisma";
import type { PushMessageInput } from "@plandit/shared/push";

import { getPushProvider } from "../push/push-provider";

/** Sends to every enabled push subscription of the user, logging each attempt like /push/test does. Returns how many succeeded. */
export async function sendPushToUser(userId: string, message: PushMessageInput) {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId, enabled: true } });
  let sent = 0;

  for (const subscription of subscriptions) {
    const delivery = await prisma.pushNotificationDelivery.create({
      data: { userId, subscriptionId: subscription.id, provider: subscription.provider, ...message, status: "PENDING" },
    });
    try {
      const result = await getPushProvider(subscription.provider).send(
        { endpoint: subscription.endpoint, externalId: subscription.externalId, metadata: subscription.metadata },
        message,
      );
      await prisma.pushNotificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", providerMessageId: result.messageId, sentAt: new Date() },
      });
      sent++;
    } catch (error) {
      await prisma.pushNotificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: error instanceof Error ? error.message : "Unknown push error." },
      });
    }
  }
  return sent;
}
