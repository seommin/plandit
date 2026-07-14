import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";
import {
  pushMessageSchema,
  pushSubscriptionCreateSchema,
  pushSubscriptionUpdateSchema,
} from "@plandit/shared/push";

import { getUserId, type RequestWithUser } from "../request-user";
import { getPushProvider } from "./push-provider";

function toSubscriptionResponse(subscription: {
  id: string;
  provider: string;
  endpoint: string;
  externalId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  platform: string | null;
  enabled: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: subscription.id,
    provider: subscription.provider,
    endpoint: subscription.endpoint,
    externalId: subscription.externalId,
    deviceName: subscription.deviceName,
    userAgent: subscription.userAgent,
    platform: subscription.platform,
    enabled: subscription.enabled,
    lastSeenAt: subscription.lastSeenAt.toISOString(),
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

@Controller("push")
export class PushController {
  @Get("subscriptions")
  async list(@Req() request: RequestWithUser) {
    const userId = getUserId(request);
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        userId,
      },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
    });

    return {
      subscriptions: subscriptions.map(toSubscriptionResponse),
    };
  }

  @Post("subscriptions")
  async upsert(@Req() request: RequestWithUser, @Body() payload: unknown) {
    const userId = getUserId(request);
    const parsed = pushSubscriptionCreateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid push subscription payload.");
    }

    const subscription = await prisma.pushSubscription.upsert({
      where: {
        provider_endpoint: {
          provider: parsed.data.provider,
          endpoint: parsed.data.endpoint,
        },
      },
      create: {
        userId,
        provider: parsed.data.provider,
        endpoint: parsed.data.endpoint,
        externalId: parsed.data.externalId,
        deviceName: parsed.data.deviceName,
        userAgent: parsed.data.userAgent,
        platform: parsed.data.platform,
        metadata: parsed.data.metadata,
        enabled: true,
      },
      update: {
        userId,
        externalId: parsed.data.externalId,
        deviceName: parsed.data.deviceName,
        userAgent: parsed.data.userAgent,
        platform: parsed.data.platform,
        metadata: parsed.data.metadata,
        enabled: true,
        lastSeenAt: new Date(),
      },
    });

    return {
      subscription: toSubscriptionResponse(subscription),
    };
  }

  @Patch("subscriptions/:subscriptionId")
  async update(
    @Req() request: RequestWithUser,
    @Param("subscriptionId") subscriptionId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = pushSubscriptionUpdateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid push subscription payload.");
    }

    const existing = await prisma.pushSubscription.findFirst({
      where: {
        id: subscriptionId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException("Push subscription not found.");
    }

    const subscription = await prisma.pushSubscription.update({
      where: {
        id: subscriptionId,
      },
      data: {
        enabled: parsed.data.enabled,
        lastSeenAt: new Date(),
      },
    });

    return {
      subscription: toSubscriptionResponse(subscription),
    };
  }

  @Delete("subscriptions/:subscriptionId")
  async remove(
    @Req() request: RequestWithUser,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    const userId = getUserId(request);
    const existing = await prisma.pushSubscription.findFirst({
      where: {
        id: subscriptionId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException("Push subscription not found.");
    }

    await prisma.pushSubscription.delete({
      where: {
        id: subscriptionId,
      },
    });

    return { ok: true };
  }

  @Post("test")
  async sendTest(@Req() request: RequestWithUser, @Body() payload: unknown) {
    const userId = getUserId(request);
    const parsed = pushMessageSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid push message payload.");
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        userId,
        enabled: true,
      },
    });

    const deliveries = [];

    for (const subscription of subscriptions) {
      const delivery = await prisma.pushNotificationDelivery.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          provider: subscription.provider,
          title: parsed.data.title,
          body: parsed.data.body,
          url: parsed.data.url,
          status: "PENDING",
        },
      });

      try {
        const provider = getPushProvider(subscription.provider);
        const result = await provider.send(
          {
            endpoint: subscription.endpoint,
            externalId: subscription.externalId,
            metadata: subscription.metadata,
          },
          parsed.data,
        );

        const updated = await prisma.pushNotificationDelivery.update({
          where: {
            id: delivery.id,
          },
          data: {
            status: "SENT",
            providerMessageId: result.messageId,
            sentAt: new Date(),
          },
        });

        deliveries.push(updated);
      } catch (error) {
        const updated = await prisma.pushNotificationDelivery.update({
          where: {
            id: delivery.id,
          },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown push error.",
          },
        });

        deliveries.push(updated);
      }
    }

    return {
      sent: deliveries.filter((delivery) => delivery.status === "SENT").length,
      failed: deliveries.filter((delivery) => delivery.status === "FAILED").length,
      total: deliveries.length,
    };
  }
}
