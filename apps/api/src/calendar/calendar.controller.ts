import { Controller, Get, Query, Req } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { getDefaultPersonalCalendar } from "../events/event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";

@Controller("calendar")
export class CalendarController {
  @Get("state")
  async state(
    @Req() request: RequestWithUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const userId = getUserId(request);

    await getDefaultPersonalCalendar(userId);

    const calendars = await prisma.calendar.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      include: {
        members: {
          where: {
            userId,
          },
          select: {
            role: true,
          },
        },
      },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    });

    const rangeStart = from ? new Date(from) : new Date(Date.UTC(2026, 5, 1));
    const rangeEnd = to ? new Date(to) : new Date(Date.UTC(2026, 6, 1));

    const events = await prisma.event.findMany({
      where: {
        startsAt: {
          lt: rangeEnd,
        },
        endsAt: {
          gte: rangeStart,
        },
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
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    });

    return {
      calendars: calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        type: calendar.type,
        color: calendar.color,
        role: calendar.members[0]?.role ?? "VIEWER",
      })),
      events: events.map((event) => ({
        id: event.id,
        calendarId: event.calendarId,
        title: event.title,
        description: event.description,
        location: event.location,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        allDay: event.allDay,
        color: event.color ?? event.calendar.color,
        visibility: event.visibility,
        calendar: event.calendar,
      })),
    };
  }
}
