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
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { prisma } from "@plandit/database/prisma";
import {
  pushMessageSchema,
  pushSubscriptionCreateSchema,
  pushSubscriptionUpdateSchema,
} from "@plandit/shared/push";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody } from "../common/zod";
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

const SUBSCRIPTION_EXAMPLE = {
  id: "cmum9m8r40009qwyjf2x6k1dp",
  provider: "WEB_PUSH",
  endpoint: "https://fcm.googleapis.com/fcm/send/demo-endpoint-7f3a9c",
  externalId: null,
  deviceName: "내 아이폰",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
  platform: "iOS",
  enabled: true,
  lastSeenAt: "2026-09-29T06:01:15.320Z",
  createdAt: "2026-09-29T06:01:15.320Z",
  updatedAt: "2026-09-29T06:01:15.320Z",
};

@ApiTags("푸시")
@Controller("push")
export class PushController {
  @Get("subscriptions")
  @ApiOperation({ summary: "내 푸시 구독 목록", description: "켜진 구독 먼저, 최근에 바뀐 순." })
  @ApiOkResponse({ example: { subscriptions: [SUBSCRIPTION_EXAMPLE] } })
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
  @ApiOperation({
    summary: "푸시 구독 등록",
    description:
      "`provider`·`endpoint`가 같은 구독이 있으면 새로 만들지 않고 지금 사용자에게 옮겨 다시 켠다. WEB_PUSH는 `metadata`에 구독 키 `p256dh`·`auth`가 있어야 발송된다.",
  })
  @ApiZodBody(pushSubscriptionCreateSchema, {
    provider: "WEB_PUSH",
    endpoint: "https://fcm.googleapis.com/fcm/send/demo-endpoint-7f3a9c",
    deviceName: "내 아이폰",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
    platform: "iOS",
    metadata: { p256dh: "BDemoP256dhKey", auth: "demoAuthKey" },
  })
  @ApiCreatedResponse({ example: { subscription: SUBSCRIPTION_EXAMPLE } })
  @ApiErrors(ErrorCode.BAD_REQUEST)
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
  @ApiOperation({ summary: "푸시 구독 켜기·끄기", description: "내 구독만(아니면 404)." })
  @ApiZodBody(pushSubscriptionUpdateSchema, { enabled: false })
  @ApiOkResponse({ example: { subscription: { ...SUBSCRIPTION_EXAMPLE, enabled: false, updatedAt: "2026-09-29T06:05:02.771Z" } } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
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
  @ApiOperation({ summary: "푸시 구독 삭제", description: "내 구독만(아니면 404)." })
  @ApiOkResponse({ example: { ok: true } })
  @ApiErrors(ErrorCode.NOT_FOUND)
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
  @ApiOperation({
    summary: "테스트 푸시 보내기",
    description: "내 켜진 구독 전부에 바로 보내고 결과를 건수로 돌려준다. 구독마다 발송 기록이 남는다.",
  })
  @ApiZodBody(pushMessageSchema, { title: "테스트 알림", body: "푸시 알림이 잘 오는지 확인해요", url: "/calendar" })
  @ApiCreatedResponse({ example: { sent: 1, failed: 0, total: 1 } })
  @ApiErrors(ErrorCode.BAD_REQUEST)
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
