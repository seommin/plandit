import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { reminderSetSchema } from "@plandit/shared/reminders";

import { ApiError, ErrorCode } from "../common/api-error";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { Public } from "../common/public.decorator";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { getWritableEvent } from "../events/event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";
import { CurrentMember, Roles } from "../workspace/roles";
import { ReminderService } from "./reminder.service";
import { RelayWebhookService } from "./relay-webhook.service";

const deliveryQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED", "SKIPPED"]).optional(),
});

@ApiTags("reminders")
@Controller()
export class ReminderController {
  constructor(private readonly reminders: ReminderService) {}

  private async writableEventId(request: RequestWithUser, eventId: string) {
    const event = await getWritableEvent(eventId, getUserId(request));
    if (!event) throw new ApiError(ErrorCode.NOT_FOUND, "Event not found.");
    return event.id;
  }

  @Get("events/:eventId/reminders")
  async list(@Req() request: RequestWithUser, @Param("eventId") eventId: string) {
    return { reminders: await this.reminders.list(await this.writableEventId(request, eventId)) };
  }

  /** Replaces the event's reminder list and (re)schedules the delayed jobs. */
  @Put("events/:eventId/reminders")
  @ApiZodBody(reminderSetSchema)
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
@Public()
@Controller("webhooks/relay")
export class RelayWebhookController {
  constructor(private readonly webhooks: RelayWebhookService) {}

  @Post("mock")
  @HttpCode(200)
  @ApiExcludeEndpoint()
  handle(@Req() request: { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!request.rawBody) throw new ApiError(ErrorCode.BAD_REQUEST, "Empty webhook body.");
    return this.webhooks.handle(request.rawBody, headers);
  }
}
