import { Injectable } from "@nestjs/common";
import type { z } from "zod";

import { type Event, prisma } from "@plandit/database/prisma";
import type { eventCreateSchema } from "@plandit/shared/events";

import { ApiError, ErrorCode } from "../common/api-error";
import type { PageQuery } from "../common/pagination";
import { getWritableCalendar } from "../events/event-permissions";
import type { ApiKeyPrincipal } from "./api-key.service";

const toEventDto = (event: Event) => ({
  id: event.id,
  calendarId: event.calendarId,
  title: event.title,
  description: event.description,
  location: event.location,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  allDay: event.allDay,
  visibility: event.visibility,
});

/** What an API key may do: the same visibility rules as its owner, limited to the key's workspace. */
@Injectable()
export class PublicApiService {
  async listEvents(key: ApiKeyPrincipal, page: PageQuery, range: { from?: string; to?: string }) {
    const rows = await prisma.event.findMany({
      where: {
        calendar: { workspaceId: key.workspaceId },
        ...(range.to ? { startsAt: { lt: new Date(range.to) } } : {}),
        ...(range.from ? { endsAt: { gte: new Date(range.from) } } : {}),
        OR: [
          { visibility: "PRIVATE", createdById: key.userId },
          { visibility: { in: ["CALENDAR", "PUBLIC_LINK"] }, calendar: { members: { some: { userId: key.userId } } } },
        ],
      },
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      orderBy: [{ startsAt: page.order }, { id: page.order }],
    });
    const items = rows.slice(0, page.limit);
    return { items: items.map(toEventDto), nextCursor: rows.length > page.limit ? items[items.length - 1].id : null };
  }

  async createEvent(key: ApiKeyPrincipal, input: z.infer<typeof eventCreateSchema>) {
    if (!input.calendarId) throw new ApiError(ErrorCode.VALIDATION_FAILED, "calendarId is required for API keys.");
    const calendar = await getWritableCalendar(input.calendarId, key.userId);
    if (!calendar || calendar.workspaceId !== key.workspaceId) throw new ApiError(ErrorCode.NOT_FOUND, "Calendar not found.");

    const event = await prisma.event.create({
      data: {
        calendarId: calendar.id,
        createdById: key.userId,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        allDay: input.allDay,
        color: input.color,
        visibility: input.visibility ?? (calendar.type === "PERSONAL" ? "PRIVATE" : "CALENDAR"),
      },
    });
    return toEventDto(event);
  }
}
