import { randomBytes } from "crypto";

import {
  Body,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { prisma } from "@plandit/database/prisma";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody } from "../common/zod";
import { getWritableEvent } from "../events/event-permissions";
import { getUserId, type RequestWithUser } from "../request-user";

const createShareSchema = z.object({
  channel: z.enum(["LINK", "KAKAO", "NAVER", "EMAIL"]).default("LINK"),
  includeDescription: z.boolean().default(true),
  includeLocation: z.boolean().default(true),
  allowGuestRsvp: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
});

const SHARE_EXAMPLE = {
  id: "cmum9k3v10008qwyjc5n2h7ra",
  eventId: "cmum9ih8o0005qwyjimytsk02",
  slug: "b7Kq2mXw9pLd",
  createdById: "cmum8us8f0000ekyjnxhqh0h4",
  channel: "LINK",
  includeDescription: true,
  includeLocation: true,
  allowGuestRsvp: false,
  viewCount: 0,
  expiresAt: "2026-10-31T14:59:59.000Z",
  revokedAt: null,
  createdAt: "2026-09-29T05:58:21.604Z",
  updatedAt: "2026-09-29T05:58:21.604Z",
};

@ApiTags("공유")
@Controller()
export class SharesController {
  @Post("events/:eventId/shares")
  @ApiOperation({
    summary: "공개 링크 만들기 (만든 사람 또는 캘린더 OWNER·ADMIN·EDITOR)",
    description:
      "부를 때마다 새 링크가 생기고, 일정 공개 범위가 PUBLIC_LINK로 바뀐다. `url`은 로그인 없이 열리는 공개 페이지 주소다. `expiresAt`을 빼면 만료되지 않는다. 일정이 없거나 권한이 없으면 404.",
  })
  @ApiZodBody(createShareSchema, {
    channel: "LINK",
    includeDescription: true,
    includeLocation: true,
    allowGuestRsvp: false,
    expiresAt: "2026-10-31T14:59:59.000Z",
  })
  @ApiCreatedResponse({ example: { share: SHARE_EXAMPLE, url: "http://localhost:3000/s/b7Kq2mXw9pLd" } })
  @ApiErrors(ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND)
  async create(
    @Req() request: RequestWithUser,
    @Param("eventId") eventId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = createShareSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid share payload.");
    }

    const event = await getWritableEvent(eventId, userId);

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    const share = await prisma.eventShare.create({
      data: {
        eventId,
        createdById: userId,
        slug: randomBytes(9).toString("base64url"),
        channel: parsed.data.channel,
        includeDescription: parsed.data.includeDescription,
        includeLocation: parsed.data.includeLocation,
        allowGuestRsvp: parsed.data.allowGuestRsvp,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
    });

    await prisma.event.update({
      where: { id: eventId },
      data: { visibility: "PUBLIC_LINK" },
    });

    const publicUrl = new URL(`/s/${share.slug}`, process.env.WEB_ORIGIN ?? "http://localhost:3000");

    return {
      share,
      url: publicUrl.toString(),
    };
  }

  @Get("shares/:slug")
  @ApiOperation({
    summary: "공개 링크로 일정 보기",
    description:
      "공개 페이지(`/s/:slug`)용이라 로그인 사용자(`x-user-id`)가 없어도 된다. 없거나 폐기·만료된 링크는 404. 부를 때마다 조회 수가 1 늘어난다(응답의 `viewCount`는 늘기 전 값). 공개 페이지에 필요한 값만 돌려주고, 링크를 만든 사람이 가린 설명(`includeDescription: false`)·장소(`includeLocation: false`)는 서버에서 `null`로 비운다 — 누가 불러도 가린 내용은 나가지 않는다.",
  })
  @ApiOkResponse({
    example: {
      share: {
        slug: "b7Kq2mXw9pLd",
        channel: "LINK",
        includeDescription: false,
        includeLocation: true,
        viewCount: 3,
        expiresAt: "2026-10-31T14:59:59.000Z",
        event: {
          title: "주간 팀 회의",
          startsAt: "2026-09-30T01:00:00.000Z",
          endsAt: "2026-09-30T02:00:00.000Z",
          allDay: false,
          description: null,
          location: "3층 회의실",
          calendar: { name: "팀 일정", timezone: "Asia/Seoul" },
        },
      },
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND)
  async read(@Param("slug") slug: string) {
    const share = await prisma.eventShare.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        channel: true,
        includeDescription: true,
        includeLocation: true,
        viewCount: true,
        expiresAt: true,
        revokedAt: true,
        event: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            description: true,
            location: true,
            calendar: { select: { name: true, timezone: true } },
          },
        },
      },
    });

    if (!share || share.revokedAt || (share.expiresAt && share.expiresAt < new Date())) {
      throw new NotFoundException("Share not found.");
    }

    await prisma.eventShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    });

    // Anyone with the link can call this (the page is public), so hidden fields must not leave the server.
    const { id: _id, revokedAt: _revokedAt, event, ...publicShare } = share;
    return {
      share: {
        ...publicShare,
        event: {
          ...event,
          description: share.includeDescription ? event.description : null,
          location: share.includeLocation ? event.location : null,
        },
      },
    };
  }
}
