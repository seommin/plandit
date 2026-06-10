import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";
import {
  eventCreateSchema,
  eventUpdateSchema,
} from "@plandit/shared/events";

import {
  getDefaultPersonalCalendar,
  getWritableCalendar,
  getWritableEvent,
} from "./event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";

@Controller("events")
export class EventsController {
  @Get()
  async list(
    @Req() request: RequestWithUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("calendarId") calendarId?: string,
  ) {
    const userId = getUserId(request);
    const events = await prisma.event.findMany({
      where: {
        ...(calendarId ? { calendarId } : {}),
        ...(from || to
          ? {
              startsAt: {
                ...(to ? { lte: new Date(to) } : {}),
              },
              endsAt: {
                ...(from ? { gte: new Date(from) } : {}),
              },
            }
          : {}),
        OR: [
          {
            visibility: "PRIVATE",
            createdById: userId,
          },
          {
            visibility: {
              in: ["CALENDAR", "PUBLIC_LINK"],
            },
            calendar: {
              members: {
                some: {
                  userId,
                },
              },
            },
          },
        ],
      },
      include: {
        calendar: {
          select: {
            id: true,
            name: true,
            type: true,
            color: true,
          },
        },
        attendees: true,
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    });

    return { events };
  }

  @Post()
  async create(@Req() request: RequestWithUser, @Body() payload: unknown) {
    const userId = getUserId(request);
    const parsed = eventCreateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid event payload.");
    }

    const calendar = parsed.data.calendarId
      ? await getWritableCalendar(parsed.data.calendarId, userId)
      : await getDefaultPersonalCalendar(userId);

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    const visibility =
      parsed.data.visibility ?? (calendar.type === "PERSONAL" ? "PRIVATE" : "CALENDAR");

    const event = await prisma.event.create({
      data: {
        calendarId: calendar.id,
        createdById: userId,
        title: parsed.data.title,
        description: parsed.data.description,
        location: parsed.data.location,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        allDay: parsed.data.allDay,
        color: parsed.data.color,
        visibility,
      },
    });

    return { event };
  }

  @Patch(":eventId")
  async update(
    @Req() request: RequestWithUser,
    @Param("eventId") eventId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = eventUpdateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid event payload.");
    }

    const event = await getWritableEvent(eventId, userId);

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    if (parsed.data.calendarId && parsed.data.calendarId !== event.calendarId) {
      const targetCalendar = await getWritableCalendar(parsed.data.calendarId, userId);

      if (!targetCalendar) {
        throw new NotFoundException("Target calendar not found.");
      }
    }

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        calendarId: parsed.data.calendarId,
        title: parsed.data.title,
        description: parsed.data.description,
        location: parsed.data.location,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : undefined,
        allDay: parsed.data.allDay,
        color: parsed.data.color,
        visibility: parsed.data.visibility,
      },
    });

    return { event: updatedEvent };
  }

  @Delete(":eventId")
  async remove(@Req() request: RequestWithUser, @Param("eventId") eventId: string) {
    const userId = getUserId(request);
    const event = await getWritableEvent(eventId, userId);

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    await prisma.event.delete({
      where: { id: eventId },
    });

    return { ok: true };
  }
}
