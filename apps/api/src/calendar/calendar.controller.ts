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
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { randomBytes } from "crypto";
import { z } from "zod";

import { prisma } from "@plandit/database/prisma";
import {
  calendarCreateSchema,
  calendarUpdateSchema,
} from "@plandit/shared/calendars";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody } from "../common/zod";
import {
  assertExistingUser,
  getCalendarMembership,
  getDefaultPersonalCalendar,
  getManageableCalendar,
} from "../events/event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";
import { ensurePersonalWorkspace } from "../workspace/personal-workspace";

const calendarInviteSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).default("VIEWER"),
});

const calendarMemberUpdateSchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

function toCalendarResponse(calendar: {
  id: string;
  workspaceId: string;
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
    workspaceId: calendar.workspaceId,
    name: calendar.name,
    type: calendar.type,
    color: calendar.color,
    description: calendar.description,
    timezone: calendar.timezone,
    isDefault: calendar.isDefault,
    role: calendar.members?.[0]?.role ?? "VIEWER",
  };
}

const CALENDAR_EXAMPLE = {
  id: "cmum8usbq0002ekyjz3o1k5wd",
  workspaceId: "cmum8us9d0001ekyjw2m7n0qa",
  name: "개발팀 캘린더",
  type: "SHARED",
  color: "#2563EB",
  description: "개발팀 회의·배포 일정",
  timezone: "Asia/Seoul",
  isDefault: false,
  role: "OWNER",
};

const MEMBER_EXAMPLE = {
  id: "cmum9a1k70003qwyj5d8r2x4b",
  role: "EDITOR",
  joinedAt: "2026-09-29T05:40:12.310Z",
  user: { id: "cmum8vx2k0001ekyj6h3n9q7t", name: "이하늘", email: "haneul@example.com", image: null },
};

@ApiTags("캘린더")
@Controller()
export class CalendarController {
  @Get("calendar/state")
  @ApiOperation({
    summary: "캘린더 화면 데이터 한 번에",
    description:
      "내 캘린더 목록과 기간 안 일정을 함께 준다(기본 개인 캘린더가 없으면 먼저 만든다). 일정은 내가 만든 비공개(PRIVATE) 일정과 내가 멤버인 캘린더의 CALENDAR·PUBLIC_LINK 일정이고, `isImportant`는 내 중요 표시다.",
  })
  @ApiQuery({ name: "from", required: false, description: "기간 시작(ISO 8601). 빼면 2026-06-01T00:00:00Z" })
  @ApiQuery({ name: "to", required: false, description: "기간 끝(ISO 8601). 빼면 2026-07-01T00:00:00Z" })
  @ApiOkResponse({
    example: {
      calendars: [CALENDAR_EXAMPLE],
      events: [
        {
          id: "cmum9ih8o0005qwyjimytsk02",
          calendarId: CALENDAR_EXAMPLE.id,
          title: "주간 팀 회의",
          description: "스프린트 진행 상황 공유",
          location: "3층 회의실",
          startsAt: "2026-09-30T01:00:00.000Z",
          endsAt: "2026-09-30T02:00:00.000Z",
          allDay: false,
          color: "#2563EB",
          visibility: "CALENDAR",
          isImportant: true,
          calendar: { id: CALENDAR_EXAMPLE.id, name: "개발팀 캘린더", type: "SHARED", color: "#2563EB" },
        },
      ],
    },
  })
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
  @ApiOperation({
    summary: "내 캘린더 목록",
    description: "내가 멤버인 캘린더 전부(기본 개인 캘린더가 없으면 먼저 만든다). `role`은 그 캘린더에서 내 역할이다.",
  })
  @ApiOkResponse({ example: { calendars: [CALENDAR_EXAMPLE] } })
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
  @ApiOperation({
    summary: "캘린더 만들기",
    description:
      "`workspaceId`를 빼면 내 개인 워크스페이스에 만든다. 내가 멤버가 아닌 워크스페이스면 404. 만든 사람이 캘린더 OWNER가 된다.",
  })
  @ApiZodBody(calendarCreateSchema, {
    name: "개발팀 캘린더",
    type: "SHARED",
    color: "#2563EB",
    description: "개발팀 회의·배포 일정",
    timezone: "Asia/Seoul",
    workspaceId: CALENDAR_EXAMPLE.workspaceId,
  })
  @ApiCreatedResponse({ example: { calendar: CALENDAR_EXAMPLE } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
  async create(@Req() request: RequestWithUser, @Body() payload: unknown) {
    const userId = getUserId(request);
    const parsed = calendarCreateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid calendar payload.");
    }

    await assertExistingUser(userId);

    const { workspaceId } = parsed.data;
    const workspace = workspaceId
      ? await prisma.workspace.findFirst({ where: { id: workspaceId, members: { some: { userId } } } })
      : await ensurePersonalWorkspace(userId);

    if (!workspace) {
      throw new NotFoundException("Workspace not found.");
    }

    const calendar = await prisma.calendar.create({
      data: {
        workspaceId: workspace.id,
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
  @ApiOperation({
    summary: "캘린더 수정 (캘린더 OWNER·ADMIN)",
    description:
      "보낸 필드만 바꾼다(하나 이상). 종류(`type`)와 워크스페이스는 바꿀 수 없다. 캘린더가 없거나 OWNER·ADMIN이 아니면 404.",
  })
  @ApiZodBody(calendarUpdateSchema, { name: "개발팀 공용", color: "#16A34A" })
  @ApiOkResponse({ example: { calendar: { ...CALENDAR_EXAMPLE, name: "개발팀 공용", color: "#16A34A" } } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
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
  @ApiOperation({
    summary: "캘린더 삭제 (캘린더 OWNER·ADMIN)",
    description:
      "캘린더의 일정·멤버·초대도 함께 지워진다. 기본 개인 캘린더는 지울 수 없다(403). 캘린더가 없거나 OWNER·ADMIN이 아니면 404.",
  })
  @ApiOkResponse({ example: { ok: true } })
  @ApiErrors(ErrorCode.FORBIDDEN, ErrorCode.NOT_FOUND)
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
  @ApiOperation({
    summary: "캘린더 멤버 목록",
    description: "캘린더 멤버면 역할과 상관없이 볼 수 있다(아니면 404). 역할 순(OWNER → VIEWER), 같은 역할은 참여한 순서.",
  })
  @ApiOkResponse({
    example: {
      members: [
        {
          id: "cmum8usc40004ekyjq2w9d7vn",
          role: "OWNER",
          joinedAt: "2026-09-29T05:31:44.902Z",
          user: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모", email: "demo@example.com", image: null },
        },
        MEMBER_EXAMPLE,
      ],
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND)
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

  @Patch("calendars/:calendarId/members/:memberId")
  @ApiOperation({
    summary: "멤버 역할 바꾸기 (캘린더 OWNER·ADMIN)",
    description:
      "ADMIN·EDITOR·VIEWER 중 하나로 바꾼다(OWNER로는 못 바꾼다). 내 역할은 바꿀 수 없다(400). 캘린더나 멤버가 없거나 OWNER·ADMIN이 아니면 404.",
  })
  @ApiZodBody(calendarMemberUpdateSchema, { role: "EDITOR" })
  @ApiOkResponse({ example: { member: MEMBER_EXAMPLE } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
  async updateMember(
    @Req() request: RequestWithUser,
    @Param("calendarId") calendarId: string,
    @Param("memberId") memberId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = calendarMemberUpdateSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid member payload.");
    }

    const calendar = await getManageableCalendar(calendarId, userId);

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    const member = await prisma.calendarMember.findFirst({
      where: {
        id: memberId,
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
    });

    if (!member) {
      throw new NotFoundException("Member not found.");
    }

    if (member.userId === userId) {
      throw new BadRequestException("You cannot change your own role.");
    }

    const updatedMember = await prisma.calendarMember.update({
      where: {
        id: memberId,
      },
      data: {
        role: parsed.data.role,
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
    });

    return {
      member: {
        id: updatedMember.id,
        role: updatedMember.role,
        joinedAt: updatedMember.joinedAt.toISOString(),
        user: updatedMember.user,
      },
    };
  }

  @Delete("calendars/:calendarId/members/:memberId")
  @ApiOperation({
    summary: "멤버 내보내기 (캘린더 OWNER·ADMIN)",
    description:
      "나 자신과 마지막 남은 OWNER는 내보낼 수 없다(400). 캘린더나 멤버가 없거나 OWNER·ADMIN이 아니면 404.",
  })
  @ApiOkResponse({ example: { ok: true } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
  async removeMember(
    @Req() request: RequestWithUser,
    @Param("calendarId") calendarId: string,
    @Param("memberId") memberId: string,
  ) {
    const userId = getUserId(request);
    const calendar = await getManageableCalendar(calendarId, userId);

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    const member = await prisma.calendarMember.findFirst({
      where: {
        id: memberId,
        calendarId,
      },
    });

    if (!member) {
      throw new NotFoundException("Member not found.");
    }

    if (member.userId === userId) {
      throw new BadRequestException("You cannot remove yourself.");
    }

    if (member.role === "OWNER") {
      const ownerCount = await prisma.calendarMember.count({
        where: {
          calendarId,
          role: "OWNER",
        },
      });

      if (ownerCount <= 1) {
        throw new BadRequestException("A calendar needs at least one owner.");
      }
    }

    await prisma.calendarMember.delete({
      where: {
        id: memberId,
      },
    });

    return { ok: true };
  }

  @Post("calendars/:calendarId/invites")
  @ApiOperation({
    summary: "이메일로 초대 (캘린더 OWNER·ADMIN)",
    description:
      "가입한 이메일이면 바로 멤버로 넣고(이미 멤버면 역할만 바뀐다) `status: \"member\"`. 아니면 14일간 유효한 초대 링크를 만들어 `status: \"invited\"`와 `url`을 돌려준다(같은 이메일의 유효한 초대가 있으면 새 토큰으로 갱신). 메일은 보내지 않으니 링크는 부른 쪽이 전달한다. 개인 캘린더는 공유(SHARED) 캘린더로 바뀐다. 나 자신은 초대할 수 없다(400). 캘린더가 없거나 OWNER·ADMIN이 아니면 404.",
  })
  @ApiZodBody(calendarInviteSchema, { email: "haneul@example.com", role: "EDITOR" })
  @ApiCreatedResponse({
    examples: {
      member: { summary: "가입한 사용자: 바로 멤버", value: { status: "member", member: MEMBER_EXAMPLE } },
      invited: {
        summary: "미가입 이메일: 초대 링크",
        value: {
          status: "invited",
          invite: {
            id: "cmum9c7q20006qwyjh4t1m8zp",
            email: "newbie@example.com",
            role: "VIEWER",
            expiresAt: "2026-10-13T05:42:03.118Z",
          },
          url: "http://localhost:3000/invite/Zx3kP9qLm2Vt8RwYb1NcQe7A",
        },
      },
    },
  })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
  async invite(
    @Req() request: RequestWithUser,
    @Param("calendarId") calendarId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = calendarInviteSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid invite payload.");
    }

    const calendar = await getManageableCalendar(calendarId, userId);

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    const email = parsed.data.email.trim().toLowerCase();
    const invitee = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (invitee) {
      if (invitee.id === userId) {
        throw new BadRequestException("You cannot invite yourself.");
      }

      const member = await prisma.calendarMember.upsert({
        where: {
          calendarId_userId: {
            calendarId,
            userId: invitee.id,
          },
        },
        create: {
          calendarId,
          userId: invitee.id,
          role: parsed.data.role,
        },
        update: {
          role: parsed.data.role,
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
      });

      if (calendar.type === "PERSONAL") {
        await prisma.calendar.update({
          where: {
            id: calendarId,
          },
          data: {
            type: "SHARED",
          },
        });
      }

      return {
        status: "member",
        member: {
          id: member.id,
          role: member.role,
          joinedAt: member.joinedAt.toISOString(),
          user: member.user,
        },
      };
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    const existingInvite = await prisma.calendarInvite.findFirst({
      where: {
        calendarId,
        email,
        acceptedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const invite = existingInvite
      ? await prisma.calendarInvite.update({
          where: {
            id: existingInvite.id,
          },
          data: {
            role: parsed.data.role,
            token: randomBytes(18).toString("base64url"),
            expiresAt,
          },
        })
      : await prisma.calendarInvite.create({
          data: {
            calendarId,
            email,
            role: parsed.data.role,
            token: randomBytes(18).toString("base64url"),
            invitedBy: userId,
            expiresAt,
          },
        });

    if (calendar.type === "PERSONAL") {
      await prisma.calendar.update({
        where: {
          id: calendarId,
        },
        data: {
          type: "SHARED",
        },
      });
    }

    return {
      status: "invited",
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
      url: new URL(
        `/invite/${invite.token}`,
        process.env.WEB_ORIGIN ?? "http://localhost:3000",
      ).toString(),
    };
  }

  @Get("invites/:token")
  @ApiOperation({
    summary: "초대 정보 보기",
    description: "초대 수락 화면용이라 로그인 사용자(`x-user-id`)가 없어도 된다. 없거나 이미 수락했거나 만료된 초대는 404.",
  })
  @ApiOkResponse({
    example: {
      invite: {
        id: "cmum9c7q20006qwyjh4t1m8zp",
        email: "newbie@example.com",
        role: "VIEWER",
        expiresAt: "2026-10-13T05:42:03.118Z",
        calendar: { id: CALENDAR_EXAMPLE.id, name: "개발팀 캘린더", color: "#2563EB", type: "SHARED" },
      },
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND)
  async readInvite(@Param("token") token: string) {
    const invite = await prisma.calendarInvite.findUnique({
      where: {
        token,
      },
      include: {
        calendar: {
          select: {
            id: true,
            name: true,
            color: true,
            type: true,
          },
        },
      },
    });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new NotFoundException("Invite not found.");
    }

    return {
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        calendar: invite.calendar,
      },
    };
  }

  @Post("invites/:token/accept")
  @ApiOperation({
    summary: "초대 수락",
    description:
      "초대받은 이메일로 로그인한 사용자만 수락할 수 있다(다르면 403). 없거나 이미 수락했거나 만료된 초대는 404. 이미 멤버면 역할이 초대의 역할로 바뀐다.",
  })
  @ApiCreatedResponse({
    example: {
      calendar: { id: CALENDAR_EXAMPLE.id, name: "개발팀 캘린더" },
      member: { id: "cmum9d2x50007qwyjt6k3b9wf", role: "VIEWER" },
    },
  })
  @ApiErrors(ErrorCode.FORBIDDEN, ErrorCode.NOT_FOUND)
  async acceptInvite(@Req() request: RequestWithUser, @Param("token") token: string) {
    const userId = getUserId(request);
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const invite = await prisma.calendarInvite.findUnique({
      where: {
        token,
      },
      include: {
        calendar: true,
      },
    });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new NotFoundException("Invite not found.");
    }

    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException("This invite belongs to another email.");
    }

    const member = await prisma.calendarMember.upsert({
      where: {
        calendarId_userId: {
          calendarId: invite.calendarId,
          userId,
        },
      },
      create: {
        calendarId: invite.calendarId,
        userId,
        role: invite.role,
      },
      update: {
        role: invite.role,
      },
    });

    await prisma.calendarInvite.update({
      where: {
        id: invite.id,
      },
      data: {
        acceptedAt: new Date(),
      },
    });

    return {
      calendar: {
        id: invite.calendar.id,
        name: invite.calendar.name,
      },
      member: {
        id: member.id,
        role: member.role,
      },
    };
  }
}
