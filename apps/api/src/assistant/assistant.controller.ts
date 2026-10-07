import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiAcceptedResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { assistantMessageSchema } from "@plandit/shared/assistant";

import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { ErrorCode } from "../common/api-error";
import { CurrentMember, Roles } from "../workspace/roles";
import { AssistantService } from "./assistant.service";

const listQuery = pageQuerySchema.extend({ order: z.enum(["asc", "desc"]).default("desc") });

const THREAD_EXAMPLE = {
  id: "cmuo1thr0001qwyj7d2k9xabc",
  title: "다음 주 화요일 오후에 1시간 팀 회의 잡아줘",
  status: "WAITING_APPROVAL",
  stopCode: null,
  credits: 9,
  items: [
    { type: "user", id: "cmuo1msg0001", text: "다음 주 화요일 오후에 1시간 팀 회의 잡아줘", createdAt: "2026-10-07T05:00:00.000Z" },
    { type: "tool", id: "cmuo1tc0001", name: "list_calendars", status: "DONE", count: 2, preview: null, error: null, eventId: null, createdAt: "2026-10-07T05:00:04.000Z" },
    { type: "tool", id: "cmuo1tc0002", name: "find_free_slots", status: "DONE", count: 2, preview: null, error: null, eventId: null, createdAt: "2026-10-07T05:00:09.000Z" },
    { type: "assistant", id: "cmuo1msg0004", text: "14일(화) 14:00–15:00이 비어 있어요(내가 볼 수 있는 일정 기준). 이 시간으로 잡을까요?", createdAt: "2026-10-07T05:00:15.000Z" },
    {
      type: "tool",
      id: "cmuo1tc0003",
      name: "create_event",
      status: "WAITING_APPROVAL",
      count: null,
      preview: { calendar: "팀 캘린더", title: "팀 회의", start: "2026-10-14T14:00:00+09:00", end: "2026-10-14T15:00:00+09:00", location: null, attendees: ["이팀원"] },
      error: null,
      eventId: null,
      createdAt: "2026-10-07T05:00:15.000Z",
    },
  ],
  createdAt: "2026-10-07T05:00:00.000Z",
  updatedAt: "2026-10-07T05:00:15.000Z",
};

@ApiTags("AI 일정 비서")
@ApiErrors(ErrorCode.NOT_FOUND)
@Controller("workspaces/:workspaceId/assistant/threads")
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  @Roles("MEMBER")
  @ApiOperation({ summary: "대화 시작 (MEMBER+)", description: "빈 대화를 만든다. 대화는 만든 사람에게만 보이고, AI 호출 크레딧은 이 워크스페이스에서 나간다." })
  @ApiCreatedResponse({ example: { ...THREAD_EXAMPLE, title: null, status: "IDLE", credits: 0, items: [] } })
  create(@CurrentMember() member: WorkspaceMember) {
    return this.assistant.createThread(member);
  }

  @Get()
  @Roles("MEMBER")
  @ApiOperation({ summary: "내 대화 목록 (MEMBER+)", description: "이 워크스페이스에서 내가 만든 대화. 기본 최신순, cursor." })
  @ApiPageQuery()
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.assistant.list(member, query);
  }

  @Get(":threadId")
  @Roles("MEMBER")
  @ApiOperation({
    summary: "대화 (만든 사람만)",
    description:
      "상태 IDLE(답함) · RUNNING(AI가 진행 중 — 이 API로 확인) · WAITING_APPROVAL(일정 변경이 승인을 기다림). `items`는 순서대로 사용자 메시지, AI 답, 도구 단계(`count`는 읽은 개수, `preview`는 승인 카드 내용). `stopCode`는 마지막 차례가 일찍 끝난 이유(STEP_LIMIT, INSUFFICIENT_CREDITS, AI_MONTHLY_LIMIT, LLM 오류 코드).",
  })
  @ApiOkResponse({ example: THREAD_EXAMPLE })
  get(@CurrentMember() member: WorkspaceMember, @Param("threadId") threadId: string) {
    return this.assistant.get(member, threadId);
  }

  @Post(":threadId/messages")
  @HttpCode(202)
  @Roles("MEMBER")
  @ApiOperation({
    summary: "메시지 보내기",
    description:
      "메시지를 저장하고 첫 AI 호출 크레딧을 선차감한 뒤(한 트랜잭션, 잔액 부족·AI 월 한도 초과면 409이고 아무것도 저장하지 않음) 워커가 이어서 진행한다. AI가 도구를 부를 때마다 호출 한 번씩 따로 선차감·정산하고, 메시지 하나에 최대 `ASSISTANT_MAX_STEPS`(8)번. AI가 진행 중이면 409. 승인을 기다리는 변경이 있으면 거절로 처리한다.",
  })
  @ApiZodBody(assistantMessageSchema, { text: "다음 주 화요일 오후에 1시간 팀 회의 잡아줘" })
  @ApiAcceptedResponse({ example: { ...THREAD_EXAMPLE, status: "RUNNING" } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.CONFLICT, ErrorCode.INSUFFICIENT_CREDITS, ErrorCode.AI_MONTHLY_LIMIT)
  send(
    @CurrentMember() member: WorkspaceMember,
    @Param("threadId") threadId: string,
    @Body(new ZodPipe(assistantMessageSchema)) body: z.infer<typeof assistantMessageSchema>,
  ) {
    return this.assistant.postMessage(member, threadId, body.text);
  }

  @Post(":threadId/tool-calls/:toolCallId/approve")
  @HttpCode(200)
  @Roles("MEMBER")
  @ApiOperation({
    summary: "변경 승인",
    description:
      "AI가 제안한 일정 변경을 실행한다. 권한(캘린더 쓰기 역할, 참석자가 캘린더 멤버인지)을 지금 다시 확인하고, 안 되면 실행하지 않고 그 이유를 AI에게 돌려준다. 두 번 눌러도 한 번만 실행된다. 이미 거절한 변경은 409.",
  })
  @ApiOkResponse({ example: { ...THREAD_EXAMPLE, status: "RUNNING" } })
  @ApiErrors(ErrorCode.CONFLICT)
  approve(@CurrentMember() member: WorkspaceMember, @Param("threadId") threadId: string, @Param("toolCallId") toolCallId: string) {
    return this.assistant.decide(member, threadId, toolCallId, true);
  }

  @Post(":threadId/tool-calls/:toolCallId/reject")
  @HttpCode(200)
  @Roles("MEMBER")
  @ApiOperation({ summary: "변경 거절", description: "실행하지 않고, 거절했다는 사실을 AI에게 돌려줘 이어서 답하게 한다. 이미 승인한 변경은 409." })
  @ApiOkResponse({ example: { ...THREAD_EXAMPLE, status: "RUNNING" } })
  @ApiErrors(ErrorCode.CONFLICT)
  reject(@CurrentMember() member: WorkspaceMember, @Param("threadId") threadId: string, @Param("toolCallId") toolCallId: string) {
    return this.assistant.decide(member, threadId, toolCallId, false);
  }
}
