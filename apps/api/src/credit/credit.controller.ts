import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { OperatorGuard } from "../common/operator.guard";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { getUserId, type RequestWithUser } from "../request-user";
import { CurrentMember, Roles } from "../workspace/roles";
import { CreditService } from "./credit.service";

const ledgerQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  type: z.enum(["CHARGE", "DEBIT", "REFUND", "ADJUST"]).optional(),
});

const adjustmentSchema = z.object({
  amount: z.number().int().refine((value) => value !== 0, "Amount must not be zero."),
  memo: z.string().trim().min(1).max(200),
});

@ApiTags("크레딧")
@ApiErrors(ErrorCode.NOT_FOUND)
@Controller()
export class CreditController {
  constructor(private readonly credits: CreditService) {}

  @Get("workspaces/:workspaceId/credits")
  @Roles("MEMBER")
  @ApiOperation({ summary: "잔액 (MEMBER+)", description: "잔액은 원장에서 파생된 캐시다. 원장에 행이 쌓일 때 같은 트랜잭션에서만 바뀐다." })
  @ApiOkResponse({ example: { accountId: "cmum8usba000fekyjhc5ezy6d", balance: 1299, updatedAt: "2026-09-29T05:55:16.783Z" } })
  balance(@CurrentMember() member: WorkspaceMember) {
    return this.credits.balance(member.workspaceId);
  }

  @Get("workspaces/:workspaceId/credits/ledger")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "원장 (ADMIN+)",
    description:
      "append-only 원장. 기본 최신순, `cursor`는 원장 id(숫자 문자열). `amount`는 부호가 있고(CHARGE·REFUND +, DEBIT −, ADJUST ±) `balanceAfter`는 그 행을 쓴 직후 잔액. `refType`/`refId`로 원인(PAYMENT·REMINDER_DELIVERY·MANUAL)을 따라간다.",
  })
  @ApiPageQuery()
  @ApiQuery({ name: "type", required: false, enum: ["CHARGE", "DEBIT", "REFUND", "ADJUST"] })
  @ApiOkResponse({
    example: {
      items: [
        {
          id: "5",
          type: "DEBIT",
          amount: -1,
          balanceAfter: 1299,
          refType: "REMINDER_DELIVERY",
          refId: "cmum9iis600001wyjx7w62uz8",
          memo: null,
          createdById: null,
          createdAt: "2026-09-29T05:55:16.789Z",
        },
        {
          id: "4",
          type: "CHARGE",
          amount: 1000,
          balanceAfter: 1300,
          refType: "PAYMENT",
          refId: "cmum9fdk10004qwyjsm3am8d5",
          memo: null,
          createdById: null,
          createdAt: "2026-09-29T05:53:30.750Z",
        },
      ],
      nextCursor: "4",
    },
  })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.FORBIDDEN)
  ledger(
    @CurrentMember() member: WorkspaceMember,
    @Query(new ZodPipe(ledgerQuerySchema)) query: z.infer<typeof ledgerQuerySchema>,
  ) {
    return this.credits.listLedger(member.workspaceId, query, query.type);
  }

  /** Manual correction by a platform operator. Retries must reuse the same Idempotency-Key. */
  @Post("admin/workspaces/:workspaceId/credits/adjustments")
  @UseGuards(OperatorGuard)
  @ApiOperation({
    summary: "수동 조정 (플랫폼 운영자)",
    description:
      "워크스페이스 역할과 무관하게 PLATFORM_ADMIN_EMAILS에 있는 운영자만(그 외 403). `ADJUST` 원장 행 하나를 쓰고 감사 로그 `credit.adjusted`를 같은 트랜잭션에 남긴다. 재시도는 같은 `Idempotency-Key`로: 같은 금액이면 기존 행을 `replayed: true`로 돌려주고 아무것도 바꾸지 않으며(감사 로그도 없음), 다른 금액이면 `IDEMPOTENCY_CONFLICT`. 음수로 잔액보다 많이 빼면 `INSUFFICIENT_CREDITS`(잔액은 0 아래로 내려가지 않음).",
  })
  @ApiHeader({ name: "idempotency-key", required: true, description: "영문·숫자·`_`·`-` 8~128자. 재시도할 때 같은 값을 보낸다." })
  @ApiZodBody(adjustmentSchema, { amount: 1000, memo: "결제 P260928-000123 만료 후 승인분 지급 (incident-001)" })
  @ApiCreatedResponse({
    example: {
      entry: {
        id: "6",
        type: "ADJUST",
        amount: 1000,
        balanceAfter: 2299,
        refType: "MANUAL",
        refId: "incident-001-adjust",
        memo: "결제 P260928-000123 만료 후 승인분 지급 (incident-001)",
        createdById: "cmum8us8f0000ekyjnxhqh0h4",
        createdAt: "2026-09-29T06:12:40.201Z",
      },
      replayed: false,
    },
  })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.FORBIDDEN, ErrorCode.INSUFFICIENT_CREDITS, ErrorCode.IDEMPOTENCY_CONFLICT)
  adjust(
    @Req() request: RequestWithUser,
    @Param("workspaceId") workspaceId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Body(new ZodPipe(adjustmentSchema)) body: z.infer<typeof adjustmentSchema>,
  ) {
    if (!requestKey || !/^[\w-]{8,128}$/.test(requestKey)) {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key header (8-128 chars) is required.");
    }
    return this.credits.adjust(workspaceId, getUserId(request), body.amount, body.memo, requestKey);
  }
}
