import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiAcceptedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { tripApplySchema, tripInputSchema, tripPlanUpdateSchema } from "@plandit/shared/trips";

import { ApiError, ErrorCode } from "../common/api-error";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { CurrentMember, Roles } from "../workspace/roles";
import { TripPlanService } from "./trip-plan.service";

const optionsQuery = z.object({ calendarId: z.string().min(1) });
const listQuery = pageQuerySchema.extend({ order: z.enum(["asc", "desc"]).default("desc") });

const PLAN_EXAMPLE = {
  id: "cmun9trip0001qwyj3p9t1abc",
  status: "READY",
  failureCode: null,
  calendar: { id: "cmum8usba000fekyjhc5ezy6d", name: "팀 캘린더", color: "#4A6FC4", timezone: "Asia/Seoul", type: "SHARED" },
  input: {
    calendarId: "cmum8usba000fekyjhc5ezy6d",
    destination: "부산",
    startDate: "2026-10-09",
    endDate: "2026-10-11",
    attendeeUserIds: ["cmum8us8f0000ekyjnxhqh0h4"],
    pace: "NORMAL",
    interests: ["FOOD"],
    request: "바다가 보이는 카페 한 곳",
  },
  draft: {
    timezone: "Asia/Seoul",
    days: [
      {
        date: "2026-10-09",
        items: [{ title: "부산역 도착", startTime: "10:00", endTime: "10:30", location: "부산역", description: null, category: "MOVE" }],
      },
    ],
    notes: "해운대는 주말 오후에 붐벼요.",
  },
  estimatedCredits: 47,
  credits: 18,
  attendees: [{ id: "cmum8us8f0000ekyjnxhqh0h4", name: "이팀원", inWorkspace: true, onCalendar: false }],
  newCalendarMemberIds: ["cmum8us8f0000ekyjnxhqh0h4"],
  addedCalendarMemberIds: [],
  eventCount: 0,
  createdAt: "2026-09-30T02:00:00.000Z",
  appliedAt: null,
};

@ApiTags("AI 여행 일정")
@ApiErrors(ErrorCode.NOT_FOUND)
@Controller("workspaces/:workspaceId/trip-plans")
export class TripPlanController {
  constructor(private readonly plans: TripPlanService) {}

  @Get("options")
  @Roles("MEMBER")
  @ApiOperation({
    summary: "양식 준비 (MEMBER+)",
    description:
      "고른 캘린더에 함께 갈 수 있는 워크스페이스 멤버와 기간별 최대 선차감 크레딧(`maxCredits`, 일수 → 크레딧), 현재 잔액. 캘린더 멤버가 아닌 사람은 요청자가 그 캘린더의 OWNER·ADMIN일 때만 `selectable`(적용할 때 VIEWER로 추가됨). 개인 캘린더는 `attendeesAllowed: false`.",
  })
  @ApiQuery({ name: "calendarId", required: true, description: "일정을 넣을 캘린더(이 워크스페이스 소속)" })
  @ApiErrors(ErrorCode.FORBIDDEN, ErrorCode.VALIDATION_FAILED)
  options(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(optionsQuery)) query: z.infer<typeof optionsQuery>) {
    return this.plans.options(member, query.calendarId);
  }

  @Post()
  @HttpCode(202)
  @Roles("MEMBER")
  @ApiOperation({
    summary: "여행 일정 초안 만들기 (MEMBER+)",
    description:
      "최대 크레딧을 선차감하고 GENERATING으로 기록한 뒤(한 트랜잭션) AI 생성 작업을 큐에 넣는다. `GET /:id`로 READY·FAILED가 될 때까지 확인한다. 같은 `Idempotency-Key`로 다시 보내면 같은 초안을 돌려주고 두 번 차감하지 않는다. 실패하면 선차감 전액을 환불한다. AI에는 인원 수만 보내고 멤버 이름·이메일은 보내지 않는다.",
  })
  @ApiHeader({ name: "idempotency-key", required: true, description: "8~128자. 버튼 한 번 누를 때마다 새로 만든다" })
  @ApiZodBody(tripInputSchema, { calendarId: "cmum8usba000fekyjhc5ezy6d", destination: "부산", startDate: "2026-10-09", endDate: "2026-10-11", attendeeUserIds: [], pace: "NORMAL", interests: ["FOOD"], request: "" })
  @ApiAcceptedResponse({ example: { ...PLAN_EXAMPLE, status: "GENERATING", draft: null, credits: 0 } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.FORBIDDEN, ErrorCode.ATTENDEE_NOT_ELIGIBLE, ErrorCode.INSUFFICIENT_CREDITS, ErrorCode.IDEMPOTENCY_CONFLICT)
  create(
    @CurrentMember() member: WorkspaceMember,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Body(new ZodPipe(tripInputSchema)) body: z.infer<typeof tripInputSchema>,
  ) {
    if (!requestKey || requestKey.length < 8 || requestKey.length > 128) {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key header (8-128 chars) is required.");
    }
    return this.plans.create(member, requestKey, body);
  }

  @Get()
  @Roles("MEMBER")
  @ApiOperation({ summary: "내 여행 초안 목록 (MEMBER+)", description: "이 워크스페이스에서 내가 만든 초안. 기본 최신순, cursor." })
  @ApiPageQuery()
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.plans.list(member, query);
  }

  @Get(":tripPlanId")
  @Roles("MEMBER")
  @ApiOperation({
    summary: "여행 초안 (만든 사람만)",
    description: "상태 GENERATING → READY/FAILED, READY → APPLIED. `newCalendarMemberIds`는 지금 적용하면 캘린더에 보기 권한으로 추가될 사람이고, 적용 요청에 그대로 보내야 한다.",
  })
  @ApiOkResponse({ example: PLAN_EXAMPLE })
  get(@CurrentMember() member: WorkspaceMember, @Param("tripPlanId") tripPlanId: string) {
    return this.plans.get(member, tripPlanId);
  }

  @Patch(":tripPlanId")
  @Roles("MEMBER")
  @ApiOperation({ summary: "초안 고치기 (READY일 때만)", description: "`days`(항목 빼기·제목·시간 수정)와 `attendeeUserIds`(함께 갈 사람)를 통째로 바꾼다. 날짜는 여행 기간 안, 끝 시각은 시작보다 뒤여야 한다." })
  @ApiZodBody(tripPlanUpdateSchema)
  @ApiOkResponse({ example: PLAN_EXAMPLE })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.CONFLICT, ErrorCode.FORBIDDEN, ErrorCode.ATTENDEE_NOT_ELIGIBLE)
  update(
    @CurrentMember() member: WorkspaceMember,
    @Param("tripPlanId") tripPlanId: string,
    @Body(new ZodPipe(tripPlanUpdateSchema)) body: z.infer<typeof tripPlanUpdateSchema>,
  ) {
    return this.plans.update(member, tripPlanId, body);
  }

  @Post(":tripPlanId/apply")
  @HttpCode(200)
  @Roles("MEMBER")
  @ApiOperation({
    summary: "캘린더에 넣기",
    description:
      "초안의 항목마다 일정을 만들고 함께 가는 사람을 참석자로 넣는다(한 트랜잭션). 캘린더 멤버가 아닌 참석자는 보기 권한(VIEWER)으로 추가되는데, 요청의 `newCalendarMemberIds`가 서버가 계산한 목록과 같아야 한다(다르면 409 `CALENDAR_MEMBERS_CHANGED`, 아무것도 바뀌지 않음). 이미 캘린더 멤버인 사람의 역할은 그대로다. 이미 적용된 초안은 그 결과를 그대로 돌려준다.",
  })
  @ApiZodBody(tripApplySchema, { newCalendarMemberIds: ["cmum8us8f0000ekyjnxhqh0h4"] })
  @ApiOkResponse({ example: { ...PLAN_EXAMPLE, status: "APPLIED", eventCount: 9, addedCalendarMemberIds: ["cmum8us8f0000ekyjnxhqh0h4"], newCalendarMemberIds: [], appliedAt: "2026-09-30T02:05:00.000Z" } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.CONFLICT, ErrorCode.FORBIDDEN, ErrorCode.ATTENDEE_NOT_ELIGIBLE, ErrorCode.CALENDAR_MEMBERS_CHANGED)
  apply(
    @CurrentMember() member: WorkspaceMember,
    @Param("tripPlanId") tripPlanId: string,
    @Body(new ZodPipe(tripApplySchema)) body: z.infer<typeof tripApplySchema>,
  ) {
    return this.plans.apply(member, tripPlanId, body.newCalendarMemberIds);
  }

  @Delete(":tripPlanId/events")
  @Roles("MEMBER")
  @ApiOperation({ summary: "되돌리기", description: "이 초안으로 만든 일정만 지우고 초안을 READY로 되돌린다. 적용할 때 캘린더에 추가된 사람은 그대로 남는다." })
  @ApiOkResponse({ example: { deleted: 9 } })
  @ApiErrors(ErrorCode.CONFLICT, ErrorCode.FORBIDDEN)
  undo(@CurrentMember() member: WorkspaceMember, @Param("tripPlanId") tripPlanId: string) {
    return this.plans.undo(member, tripPlanId);
  }
}
