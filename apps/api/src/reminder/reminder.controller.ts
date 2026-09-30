import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { reminderSetSchema } from "@plandit/shared/reminders";

import { ApiError, ErrorCode } from "../common/api-error";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { Public } from "../common/public.decorator";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { getWritableEvent } from "../events/event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";
import { CurrentMember, Roles } from "../workspace/roles";
import { webhookSchema } from "./mock-relay.adapter";
import { ReminderService } from "./reminder.service";
import { RelayWebhookService } from "./relay-webhook.service";

const deliveryQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED", "SKIPPED"]).optional(),
});

@ApiTags("리마인더")
@Controller()
export class ReminderController {
  constructor(private readonly reminders: ReminderService) {}

  private async writableEventId(request: RequestWithUser, eventId: string) {
    const event = await getWritableEvent(eventId, getUserId(request));
    if (!event) throw new ApiError(ErrorCode.NOT_FOUND, "Event not found.");
    return event.id;
  }

  @Get("events/:eventId/reminders")
  @ApiOperation({ summary: "일정의 알림 목록", description: "일정을 수정할 수 있는 사람만(없거나 권한이 없으면 404)." })
  @ApiOkResponse({
    example: {
      reminders: [{ id: "cmumab1x20007qwyj0k2t9f1c", eventId: "cmum9ih8o0005qwyjimytsk02", minutesBefore: 10, channel: "SMS", audience: "CREATOR", createdById: "cmum8us8f0000ekyjnxhqh0h4", createdAt: "2026-09-29T05:54:02.113Z" }],
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND)
  async list(@Req() request: RequestWithUser, @Param("eventId") eventId: string) {
    return { reminders: await this.reminders.list(await this.writableEventId(request, eventId)) };
  }

  /** Replaces the event's reminder list and (re)schedules the delayed jobs. */
  @Put("events/:eventId/reminders")
  @ApiOperation({
    summary: "일정의 알림 전체 바꾸기",
    description:
      "목록을 통째로 바꾸고 지연 작업을 다시 예약한다(최대 5개, 같은 시점·채널 중복 불가). 크레딧은 여기서 빠지지 않는다 — 발송 시점에 워커가 차감하고, 실패하면 환불한다. 문자·알림톡은 받는 사람마다 1크레딧, 푸시는 무료.",
  })
  @ApiZodBody(reminderSetSchema, { reminders: [{ minutesBefore: 10, channel: "SMS", audience: "CREATOR" }, { minutesBefore: 0, channel: "PUSH", audience: "CREATOR" }] })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.NOT_FOUND)
  async set(
    @Req() request: RequestWithUser,
    @Param("eventId") eventId: string,
    @Body(new ZodPipe(reminderSetSchema)) body: z.infer<typeof reminderSetSchema>,
  ) {
    const id = await this.writableEventId(request, eventId);
    return { reminders: await this.reminders.setReminders(id, getUserId(request), body.reminders) };
  }

  /** What was sent on the workspace's account (ADMIN+): status, cost, refunds. */
  @Get("workspaces/:workspaceId/reminder-deliveries")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "발송 내역 (ADMIN+)",
    description: "이 워크스페이스 크레딧으로 나간 리마인더. 상태: QUEUED → SENT → DELIVERED/FAILED, 보낼 수 없던 건은 SKIPPED. 실패한 유료 발송은 `refunded: true`.",
  })
  @ApiOkResponse({
    example: {
      items: [
        {
          id: "cmum9iis600001wyjx7w62uz8",
          channel: "SMS",
          status: "DELIVERED",
          credits: 1,
          failCode: null,
          fallback: null,
          fireAt: "2026-09-29T05:55:16.689Z",
          queuedAt: "2026-09-29T05:55:16.755Z",
          sentAt: "2026-09-29T05:55:16.852Z",
          resultAt: "2026-09-29T05:55:19.862Z",
          user: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모" },
          reminder: { event: { id: "cmum9ih8o0005qwyjimytsk02", title: "UI 확인용 리마인더" } },
          refunded: false,
        },
      ],
      nextCursor: null,
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  @ApiPageQuery()
  @ApiQuery({ name: "status", required: false, enum: ["QUEUED", "SENT", "DELIVERED", "FAILED", "SKIPPED"] })
  deliveries(
    @CurrentMember() member: WorkspaceMember,
    @Query(new ZodPipe(deliveryQuerySchema)) query: z.infer<typeof deliveryQuerySchema>,
  ) {
    return this.reminders.listDeliveries(member.workspaceId, query, query.status);
  }
}

/** Called by the carrier: authenticated by the HMAC signature, not the internal secret. */
@ApiTags("웹훅")
@Public()
@Controller("webhooks/relay")
export class RelayWebhookController {
  constructor(private readonly webhooks: RelayWebhookService) {}

  @Post("mock")
  @HttpCode(200)
  @ApiOperation({
    summary: "문자 발송 결과 웹훅 (모의 중계사가 호출)",
    description:
      "서명 확인 → 이벤트 저장(`eventId` 유니크) → 발송 건 확정(실패면 환불)을 한 트랜잭션에서 한다. 같은 결과가 두 번 와도 환불은 한 번만(`DUPLICATE_EVENT`/`ALREADY_APPLIED`).",
  })
  @ApiHeader({ name: "x-mock-signature", required: true, description: "원문 본문(raw body)의 HMAC-SHA256 hex. 비밀값은 MOCK_RELAY_WEBHOOK_SECRET" })
  @ApiZodBody(webhookSchema, { eventId: "rly_evt_91b2", msgId: "msg_5c1d", clientRef: "cmum9iis600001wyjx7w62uz8", status: "FAILED", failCode: "INVALID_NUMBER" })
  @ApiOkResponse({ description: "APPLIED · ALREADY_APPLIED · DUPLICATE_EVENT · UNKNOWN_DELIVERY", example: { eventId: "rly_evt_91b2", result: "APPLIED" } })
  @ApiErrors(ErrorCode.UNAUTHORIZED, ErrorCode.VALIDATION_FAILED)
  handle(@Req() request: { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!request.rawBody) throw new ApiError(ErrorCode.BAD_REQUEST, "Empty webhook body.");
    return this.webhooks.handle(request.rawBody, headers);
  }
}
