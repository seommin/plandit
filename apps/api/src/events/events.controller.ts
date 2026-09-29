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
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";

import { prisma } from "@plandit/database/prisma";
import {
  eventCreateSchema,
  eventUpdateSchema,
} from "@plandit/shared/events";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody } from "../common/zod";
import {
  getDefaultPersonalCalendar,
  getWritableCalendar,
  getWritableEvent,
} from "./event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";
import { ReminderService } from "../reminder/reminder.service";

const EVENT_EXAMPLE = {
  id: "cmum9ih8o0005qwyjimytsk02",
  calendarId: "cmum8usbq0002ekyjz3o1k5wd",
  createdById: "cmum8us8f0000ekyjnxhqh0h4",
  title: "주간 팀 회의",
  description: "스프린트 진행 상황 공유",
  location: "3층 회의실",
  startsAt: "2026-09-30T01:00:00.000Z",
  endsAt: "2026-09-30T02:00:00.000Z",
  allDay: false,
  status: "CONFIRMED",
  visibility: "CALENDAR",
  color: null,
  recurrence: null,
  externalId: null,
  createdAt: "2026-09-29T05:52:10.412Z",
  updatedAt: "2026-09-29T05:52:10.412Z",
};

@ApiTags("일정")
@Controller("events")
export class EventsController {
  constructor(private readonly reminders: ReminderService) {}

  @Get()
  @ApiOperation({
    summary: "일정 목록",
    description:
      "내가 만든 비공개(PRIVATE) 일정과 내가 멤버인 캘린더의 CALENDAR·PUBLIC_LINK 일정. `from`·`to`를 주면 그 기간과 겹치는 일정만, 시작 시각 순. 참석자(`attendees`)를 함께 준다.",
  })
  @ApiQuery({ name: "from", required: false, description: "기간 시작(ISO 8601)" })
  @ApiQuery({ name: "to", required: false, description: "기간 끝(ISO 8601)" })
  @ApiQuery({ name: "calendarId", required: false, description: "이 캘린더의 일정만" })
  @ApiOkResponse({
    example: {
      events: [
        {
          ...EVENT_EXAMPLE,
          calendar: { id: EVENT_EXAMPLE.calendarId, name: "개발팀 캘린더", type: "SHARED", color: "#2563EB" },
          attendees: [],
        },
      ],
    },
  })
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
  @ApiOperation({
    summary: "일정 만들기 (캘린더 OWNER·ADMIN·EDITOR)",
    description:
      "`calendarId`를 빼면 내 기본 개인 캘린더에 만든다. 캘린더가 없거나 쓰기 역할(OWNER·ADMIN·EDITOR)이 아니면 404. `visibility`를 빼면 개인 캘린더는 PRIVATE, 그 밖은 CALENDAR.",
  })
  @ApiZodBody(eventCreateSchema, {
    calendarId: EVENT_EXAMPLE.calendarId,
    title: "주간 팀 회의",
    description: "스프린트 진행 상황 공유",
    location: "3층 회의실",
    startsAt: "2026-09-30T01:00:00.000Z",
    endsAt: "2026-09-30T02:00:00.000Z",
    allDay: false,
    visibility: "CALENDAR",
  })
  @ApiCreatedResponse({ example: { event: EVENT_EXAMPLE } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
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
  @ApiOperation({
    summary: "일정 수정 (만든 사람 또는 캘린더 OWNER·ADMIN·EDITOR)",
    description:
      "보낸 필드만 바꾼다. 일정이 없거나 권한이 없으면 404. 다른 캘린더로 옮기면 그 캘린더에도 쓰기 역할이 있어야 한다(없으면 404). 저장 후 이 일정의 알림을 현재 시작 시각 기준으로 다시 예약한다 — 시각이 바뀌었으면 새 시각에 발송되고 이전 예약은 발송되지 않는다.",
  })
  @ApiZodBody(eventUpdateSchema, { startsAt: "2026-09-30T02:00:00.000Z", endsAt: "2026-09-30T03:00:00.000Z", location: "5층 대회의실" })
  @ApiOkResponse({
    example: {
      event: {
        ...EVENT_EXAMPLE,
        startsAt: "2026-09-30T02:00:00.000Z",
        endsAt: "2026-09-30T03:00:00.000Z",
        location: "5층 대회의실",
        updatedAt: "2026-09-29T06:03:41.227Z",
      },
    },
  })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
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

    // Time or calendar may have moved: schedule reminders at the new fire time (old jobs become stale).
    await this.reminders.syncEvent(eventId);

    return { event: updatedEvent };
  }

  @Patch(":eventId/important")
  @ApiOperation({
    summary: "중요 표시 켜기·끄기",
    description: "부를 때마다 내 중요 표시가 뒤집힌다(나에게만 보인다). 볼 수 있는 일정이면 VIEWER도 된다. 볼 수 없는 일정은 404.",
  })
  @ApiOkResponse({ example: { isImportant: true } })
  @ApiErrors(ErrorCode.NOT_FOUND)
  async toggleImportant(@Req() request: RequestWithUser, @Param("eventId") eventId: string) {
    const userId = getUserId(request);
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
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
      select: {
        id: true,
      },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    const favorite = await prisma.eventFavorite.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (favorite) {
      await prisma.eventFavorite.delete({
        where: {
          eventId_userId: {
            eventId,
            userId,
          },
        },
      });

      return { isImportant: false };
    }

    await prisma.eventFavorite.create({
      data: {
        eventId,
        userId,
      },
    });

    return { isImportant: true };
  }

  @Delete(":eventId")
  @ApiOperation({
    summary: "일정 삭제 (만든 사람 또는 캘린더 OWNER·ADMIN·EDITOR)",
    description: "알림 설정·공개 링크도 함께 지워지고, 이미 예약된 알림은 발송되지 않는다. 일정이 없거나 권한이 없으면 404.",
  })
  @ApiOkResponse({ example: { ok: true } })
  @ApiErrors(ErrorCode.NOT_FOUND)
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
