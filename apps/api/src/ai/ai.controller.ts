import { Body, Controller, Get, Patch, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { aiLimitUpdateSchema } from "@plandit/shared/ai";

import { ErrorCode } from "../common/api-error";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { CurrentMember, Roles } from "../workspace/roles";
import { AiUsageService } from "./ai-usage.service";

const STATUSES = ["RESERVED", "CALLING", "SUCCEEDED", "FAILED"] as const;
const FEATURES = ["SCHEDULE_ASSISTANT", "MEMORY_SEARCH", "TRIP_PLANNER"] as const;

const usageQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(STATUSES).optional(),
  feature: z.enum(FEATURES).optional(),
});

const LIMIT_EXAMPLE = {
  monthlyCreditLimit: 5000,
  used: 1240,
  remaining: 3760,
  periodStart: "2026-09-30T15:00:00.000Z",
  resetsAt: "2026-10-31T15:00:00.000Z",
};

@ApiTags("AI")
@Controller()
export class AiController {
  constructor(private readonly usages: AiUsageService) {}

  @Get("workspaces/:workspaceId/ai-limit")
  @Roles("MEMBER")
  @ApiOperation({
    summary: "AI 월 한도 (MEMBER+)",
    description:
      "이 워크스페이스가 한 달(한국 시간 1일 0시 기준)에 AI로 쓸 수 있는 크레딧과 이번 달 사용량. 사용량 = 끝난 호출의 청구액 + 진행 중인 호출의 선차감액. `monthlyCreditLimit`가 null이면 상한 없음(`remaining`도 null). 다음 초기화는 `resetsAt`.",
  })
  @ApiOkResponse({ example: LIMIT_EXAMPLE })
  @ApiErrors(ErrorCode.NOT_FOUND)
  limit(@CurrentMember() member: WorkspaceMember) {
    return this.usages.limitOf(member.workspaceId);
  }

  @Patch("workspaces/:workspaceId/ai-limit")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "AI 월 한도 바꾸기 (ADMIN+)",
    description:
      "`monthlyCreditLimit`(1~10,000,000)를 정하거나 null로 없앤다. 이번 달 사용량보다 낮춰도 되고, 그러면 다음 달까지 새 AI 호출은 409 `AI_MONTHLY_LIMIT`. 이미 진행 중인 호출은 그대로 끝난다. 바뀌면 감사 로그 `workspace.ai_limit_changed`(같은 값으로 다시 보내면 기록 안 함).",
  })
  @ApiZodBody(aiLimitUpdateSchema, { monthlyCreditLimit: 5000 })
  @ApiOkResponse({ example: LIMIT_EXAMPLE })
  @ApiErrors(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN, ErrorCode.VALIDATION_FAILED)
  setLimit(@CurrentMember() member: WorkspaceMember, @Body(new ZodPipe(aiLimitUpdateSchema)) body: { monthlyCreditLimit: number | null }) {
    return this.usages.setLimit(member, body.monthlyCreditLimit);
  }

  /** What AI calls cost the workspace (ADMIN+). */
  @Get("workspaces/:workspaceId/ai-usages")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "AI 사용 내역 (ADMIN+)",
    description:
      "LLM 호출 한 번이 한 행. 호출 전에 `estimatedCredits`를 선차감(DEBIT)하고, 끝나면 실제 사용량으로 `credits`를 청구한 뒤 남는 만큼 돌려준다(ADJUST). 실패하면 선차감 전액을 환불한다(REFUND). 청구는 선차감을 넘지 않는다. 상태: RESERVED → CALLING → SUCCEEDED/FAILED. 기본 최신순.",
  })
  @ApiOkResponse({
    example: {
      items: [
        {
          id: "cmun2y1k00003qwyj3p9t1abc",
          feature: "TRIP_PLANNER",
          status: "SUCCEEDED",
          provider: "anthropic",
          model: "claude-opus-5-5",
          maxOutputTokens: 16000,
          estimatedCredits: 58,
          credits: 21,
          inputTokens: 1840,
          outputTokens: 7120,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          attempts: [{ model: "claude-opus-5-5", inputTokens: 1840, outputTokens: 7120, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }],
          failureCode: null,
          latencyMs: 48213,
          debitLedgerId: "41",
          adjustLedgerId: "42",
          refundLedgerId: null,
          createdAt: "2026-09-30T01:02:03.000Z",
          startedAt: "2026-09-30T01:02:03.050Z",
          finishedAt: "2026-09-30T01:02:51.300Z",
          user: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모" },
        },
      ],
      nextCursor: null,
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN, ErrorCode.VALIDATION_FAILED)
  @ApiPageQuery()
  @ApiQuery({ name: "status", required: false, enum: STATUSES })
  @ApiQuery({ name: "feature", required: false, enum: FEATURES })
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(usageQuerySchema)) query: z.infer<typeof usageQuerySchema>) {
    return this.usages.list(member.workspaceId, query, { status: query.status, feature: query.feature });
  }
}
