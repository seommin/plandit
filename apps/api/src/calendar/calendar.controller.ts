import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  calendarCreateSchema,
  calendarUpdateSchema,
} from "@plandit/shared/calendars";

import {
  assertExistingUser,
  getCalendarMembership,
  getDefaultPersonalCalendar,
  getManageableCalendar,
} from "../events/event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";

function toCalendarResponse(calendar: {
  id: string;
  name: string;
  type: "PERSONAL" | "SHARED" | "SUBSCRIBED";
  color: string;
  description: string | null;
  timezone: string;
  isDefault: boolean;
  members?: Array<{ role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" }>;
}) {
  return {
    id: calendar.id,
    name: calendar.name,
    type: calendar.type,
    color: calendar.color,
    description: calendar.description,
    timezone: calendar.timezone,
    isDefault: calendar.isDefault,
    role: calendar.members?.[0]?.role ?? "VIEWER",
  };
}

@Controller()
export class CalendarController {
  @Get("calendar/state")
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
        favorites: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    });

    return {
      calendars: calendars.map((calendar) => ({
        ...toCalendarResponse(calendar),
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
        isImportant: event.favorites.length > 0,
        calendar: event.calendar,
      })),
    };
  }

  @Get("calendars")
  async list(@Req() request: RequestWithUser) {
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

    return {
      calendars: calendars.map(toCalendarResponse),
    };
  }

  @Post("calendars")
  async create(@Req() request: RequestWithUser, @Body() payload: unknown) {
    const userId = getUserId(request);
    const parsed = calendarCreateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid calendar payload.");
    }

    await assertExistingUser(userId);

    const calendar = await prisma.calendar.create({
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        color: parsed.data.color,
        description: parsed.data.description,
        timezone: parsed.data.timezone,
        members: {
          create: {
            userId,
            role: "OWNER",
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
    });

    return { calendar: toCalendarResponse(calendar) };
  }

  @Patch("calendars/:calendarId")
  async update(
    @Req() request: RequestWithUser,
    @Param("calendarId") calendarId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = calendarUpdateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid calendar payload.");
    }

    const calendar = await getManageableCalendar(calendarId, userId);

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    const updatedCalendar = await prisma.calendar.update({
      where: {
        id: calendarId,
      },
      data: parsed.data,
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
    });

    return { calendar: toCalendarResponse(updatedCalendar) };
  }

  @Delete("calendars/:calendarId")
  async remove(@Req() request: RequestWithUser, @Param("calendarId") calendarId: string) {
    const userId = getUserId(request);
    const calendar = await getManageableCalendar(calendarId, userId);

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    if (calendar.isDefault) {
      throw new ForbiddenException("Default calendars cannot be deleted.");
    }

    await prisma.calendar.delete({
      where: {
        id: calendarId,
      },
    });

    return { ok: true };
  }

  @Get("calendars/:calendarId/members")
  async members(@Req() request: RequestWithUser, @Param("calendarId") calendarId: string) {
    const userId = getUserId(request);
    const membership = await getCalendarMembership(calendarId, userId);

    if (!membership) {
      throw new NotFoundException("Calendar not found.");
    }

    const members = await prisma.calendarMember.findMany({
      where: {
        calendarId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });

    return {
      members: members.map((member) => ({
        id: member.id,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        user: member.user,
      })),
    };
  }
}
