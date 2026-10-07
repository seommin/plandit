import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { apiKeyCreateSchema } from "@plandit/shared/api-keys";
import { eventCreateSchema } from "@plandit/shared/events";

import { ErrorCode } from "../common/api-error";
import { ApiPageQuery, type PageQuery, pageQuerySchema } from "../common/pagination";
import { Public } from "../common/public.decorator";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { CreditService } from "../credit/credit.service";
import { CurrentMember, Roles } from "../workspace/roles";
import { ApiKeyGuard, CurrentApiKey, RequireScope } from "./api-key.guard";
import { type ApiKeyPrincipal, ApiKeyService } from "./api-key.service";
import { PublicApiService } from "./public-api.service";

const API_KEY_EXAMPLE = {
  id: "cmumc2k9d0009qwyj1v7h3n6s",
  name: "사내 대시보드 연동",
  prefix: "pk_demo_4f8",
  scopes: ["events:read", "credits:read"],
  expiresAt: "2026-12-28T06:10:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-09-29T06:10:00.000Z",
};

/** Key management, used from the web app (internal secret + user). */
@ApiTags("API 키")
@ApiErrors(ErrorCode.NOT_FOUND)
@Controller("workspaces/:workspaceId/api-keys")
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  /** The response contains the token; it is never shown again. */
  @Post()
  @Roles("MEMBER")
  @ApiOperation({
    summary: "API 키 발급 (MEMBER+)",
    description:
      "키 원문(`token`)은 이 응답에만 한 번 나오고 서버에는 해시만 남는다. 스코프: `events:read`(일정 조회) · `events:write`(일정 만들기) · `credits:read`(잔액 조회). `expiresInDays`(1~365)를 빼면 만료되지 않는다. 키는 만든 사람의 권한을 넘지 못하고, 만든 사람이 워크스페이스를 떠나면 더 이상 쓸 수 없다. 감사 로그에 남는다.",
  })
  @ApiZodBody(apiKeyCreateSchema, { name: "사내 대시보드 연동", scopes: ["events:read", "credits:read"], expiresInDays: 90 })
  @ApiCreatedResponse({ example: { apiKey: API_KEY_EXAMPLE, token: "pk_demo_4f8b2c9e7a1d6f3b0c5e8a2d7f4" } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  create(@CurrentMember() member: WorkspaceMember, @Body(new ZodPipe(apiKeyCreateSchema)) body: z.infer<typeof apiKeyCreateSchema>) {
    return this.keys.create(member, body);
  }

  @Get()
  @Roles("MEMBER")
  @ApiOperation({
    summary: "API 키 목록 (MEMBER+)",
    description: "MEMBER는 내 키만, ADMIN+는 워크스페이스의 모든 키(`owner`로 만든 사람 표시). 폐기된 키도 `revokedAt`과 함께 나온다.",
  })
  @ApiPageQuery()
  @ApiOkResponse({
    example: {
      items: [
        {
          ...API_KEY_EXAMPLE,
          lastUsedAt: "2026-09-29T07:21:48.090Z",
          owner: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모", email: "demo@example.com" },
        },
      ],
      nextCursor: null,
    },
  })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    return this.keys.list(member, page);
  }

  /** Own keys, or any key in the workspace for ADMIN+. */
  @Delete(":keyId")
  @Roles("MEMBER")
  @ApiOperation({
    summary: "API 키 폐기 (MEMBER+)",
    description:
      "MEMBER는 내 키만, ADMIN+는 워크스페이스의 모든 키를 폐기할 수 있다(그 밖의 키는 404). 폐기한 키는 바로 401이 된다. 이미 폐기된 키면 그대로 돌려준다(감사 로그는 처음 한 번만).",
  })
  @ApiOkResponse({ example: { apiKey: { ...API_KEY_EXAMPLE, revokedAt: "2026-09-30T00:12:05.431Z" } } })
  async revoke(@CurrentMember() member: WorkspaceMember, @Param("keyId") keyId: string) {
    return { apiKey: await this.keys.revoke(member, keyId) };
  }
}

const eventsQuerySchema = pageQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const V1_EVENT_EXAMPLE = {
  id: "cmum9ih8o0005qwyjimytsk02",
  calendarId: "cmum8usbq0002ekyjz3o1k5wd",
  title: "주간 팀 회의",
  description: "스프린트 진행 상황 공유",
  location: "3층 회의실",
  startsAt: "2026-09-30T01:00:00.000Z",
  endsAt: "2026-09-30T02:00:00.000Z",
  allDay: false,
  visibility: "CALENDAR",
};

const V1_RULES =
  "키가 없거나 틀리거나 폐기·만료됐으면 모두 같은 401. 키마다 분당 요청 수 제한(`API_KEY_RATE_LIMIT_PER_MIN`, 기본 60)이 있고, 넘으면 429와 `Retry-After` 헤더. 남은 횟수는 응답 헤더 `x-ratelimit-limit`·`x-ratelimit-remaining`.";

/** Public API for scripts and integrations: `Authorization: Bearer pk_…`. */
@ApiTags("공개 API (v1)")
@ApiBearerAuth("api-key")
@ApiErrors(ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN, ErrorCode.RATE_LIMITED)
@Public()
@UseGuards(ApiKeyGuard)
@Controller("v1")
export class PublicApiController {
  constructor(
    private readonly api: PublicApiService,
    private readonly credits: CreditService,
  ) {}

  @Get("events")
  @RequireScope("events:read")
  @ApiOperation({
    summary: "일정 목록 (스코프 events:read)",
    description: `키 주인이 볼 수 있는 일정 중 키가 속한 워크스페이스의 캘린더 일정만. \`from\`·\`to\`를 주면 그 기간과 겹치는 일정만, 시작 시각 순(\`order\`로 방향). \`cursor\`는 이전 페이지 마지막 일정의 id. 스코프가 없으면 403. ${V1_RULES}`,
  })
  @ApiPageQuery()
  @ApiQuery({ name: "from", required: false, description: "기간 시작(ISO 8601)" })
  @ApiQuery({ name: "to", required: false, description: "기간 끝(ISO 8601)" })
  @ApiOkResponse({ example: { items: [V1_EVENT_EXAMPLE], nextCursor: null } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  events(@CurrentApiKey() key: ApiKeyPrincipal, @Query(new ZodPipe(eventsQuerySchema)) query: z.infer<typeof eventsQuerySchema>) {
    return this.api.listEvents(key, query, query);
  }

  @Post("events")
  @RequireScope("events:write")
  @ApiOperation({
    summary: "일정 만들기 (스코프 events:write)",
    description: `\`calendarId\`가 꼭 있어야 한다(없으면 400). 키가 속한 워크스페이스의 캘린더이고 키 주인이 그 캘린더 멤버여야 하며(아니면 404), 쓰기 역할(OWNER·ADMIN·EDITOR)이어야 한다(아니면 403). \`visibility\`를 빼면 개인 캘린더는 PRIVATE, 그 밖은 CALENDAR. 스코프가 없으면 403. ${V1_RULES}`,
  })
  @ApiZodBody(eventCreateSchema, {
    calendarId: "cmum8usbq0002ekyjz3o1k5wd",
    title: "주간 팀 회의",
    description: "스프린트 진행 상황 공유",
    location: "3층 회의실",
    startsAt: "2026-09-30T01:00:00.000Z",
    endsAt: "2026-09-30T02:00:00.000Z",
    allDay: false,
  })
  @ApiCreatedResponse({ example: { event: V1_EVENT_EXAMPLE } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.NOT_FOUND)
  async createEvent(@CurrentApiKey() key: ApiKeyPrincipal, @Body(new ZodPipe(eventCreateSchema)) body: z.infer<typeof eventCreateSchema>) {
    return { event: await this.api.createEvent(key, body) };
  }

  @Get("credits")
  @RequireScope("credits:read")
  @ApiOperation({
    summary: "크레딧 잔액 (스코프 credits:read)",
    description: `키가 속한 워크스페이스의 잔액. 스코프가 없으면 403. ${V1_RULES}`,
  })
  @ApiOkResponse({ example: { accountId: "cmum8usa90003ekyj4q1w8e2r", balance: 1200, updatedAt: "2026-09-29T05:55:19.870Z" } })
  balance(@CurrentApiKey() key: ApiKeyPrincipal) {
    return this.credits.balance(key.workspaceId);
  }
}
