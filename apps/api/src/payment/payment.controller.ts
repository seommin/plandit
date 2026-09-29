import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { chargeSchema } from "@plandit/shared/credits";

import { ApiError, ErrorCode } from "../common/api-error";
import { ApiPageQuery, type PageQuery, pageQuerySchema } from "../common/pagination";
import { Public } from "../common/public.decorator";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { CurrentMember, Roles } from "../workspace/roles";
import { webhookSchema } from "./mock-pg.adapter";
import { PaymentWebhookService } from "./payment-webhook.service";

const PAYMENT_EXAMPLE = {
  id: "cmum9fdk10004qwyjsm3am8d5",
  tradeId: "P260929-000002",
  status: "APPROVED",
  amount: 10000,
  credits: 1000,
  paymentPageUrl: "http://localhost:4100/pg/pay/tx_0acb3a482c074bd0b6a01f9fd161bd1e",
  method: "CARD",
  failureCode: null,
  createdAt: "2026-09-29T05:52:50.017Z",
  approvedAt: "2026-09-29T05:53:30.686Z",
  failedAt: null,
};
import { PaymentService } from "./payment.service";

@ApiTags("결제")
@ApiErrors(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
@Controller("workspaces/:workspaceId/payments")
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  /** Starts a top-up and returns the PG payment page URL. Credits arrive only via the PG webhook. */
  @Post("charge")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "충전 시작 (ADMIN+)",
    description:
      "결제를 `RESERVE`로 먼저 저장한 뒤 PG를 부르고 결제 페이지 주소를 돌려준다. 크레딧은 여기서 늘지 않고 PG 웹훅(또는 재조회 작업)이 승인을 확정할 때 원장에 한 번만 기록된다. 1크레딧 = 10원, 1,000원 ~ 1,000,000원. 모의 PG는 금액 끝 두 자리로 결과를 정한다(00 승인, 01 실패, 03 웹훅 두 번, 05 웹훅 누락).",
  })
  @ApiZodBody(chargeSchema, { amount: 10000 })
  @ApiOkResponse({ example: { payment: { ...PAYMENT_EXAMPLE, status: "RESERVE", method: null, approvedAt: null } } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.PAYMENT_GATEWAY_ERROR)
  async charge(
    @CurrentMember() member: WorkspaceMember,
    @Body(new ZodPipe(chargeSchema)) body: z.infer<typeof chargeSchema>,
  ) {
    return { payment: await this.payments.charge(member.workspaceId, member.userId, body.amount) };
  }

  @Get()
  @Roles("ADMIN")
  @ApiOperation({ summary: "결제 목록 (ADMIN+)", description: "최근 것부터. 상태: RESERVE(진행 중) · APPROVED · FAILED · CANCELED · UNKNOWN(PG 응답 유실, 재조회 대기)" })
  @ApiPageQuery()
  @ApiOkResponse({ example: { items: [PAYMENT_EXAMPLE], nextCursor: null } })
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    return this.payments.list(member.workspaceId, page);
  }

  @Get(":paymentId")
  @Roles("ADMIN")
  @ApiOperation({ summary: "결제 한 건 (ADMIN+)", description: "결제 결과 화면이 승인·실패를 기다리며 이 경로를 다시 부른다." })
  @ApiOkResponse({ example: { payment: PAYMENT_EXAMPLE } })
  async get(@CurrentMember() member: WorkspaceMember, @Param("paymentId") paymentId: string) {
    return { payment: await this.payments.get(member.workspaceId, paymentId) };
  }
}

/** Called by the PG, not by our web app: authenticated by the HMAC signature instead of the internal secret. */
@ApiTags("웹훅")
@Public()
@Controller("webhooks/payments")
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post("mock")
  @HttpCode(200)
  @ApiOperation({
    summary: "PG 결제 결과 웹훅 (모의 PG가 호출)",
    description:
      "서명 확인 → 이벤트 저장(`eventId` 유니크) → 결제 행 잠금 → 상태 전이 → 원장 기록을 한 트랜잭션에서 한다. 같은 `eventId`가 다시 오면 `DUPLICATE_EVENT`, 이미 승인된 결제에 다른 이벤트가 오면 `ALREADY_APPLIED`로 끝나 잔액은 한 번만 바뀐다. 처리한 이벤트는 모두 200으로 답해 PG가 재전송을 멈추게 한다.",
  })
  @ApiHeader({ name: "x-mock-signature", required: true, description: "원문 본문(raw body)의 HMAC-SHA256 hex. 비밀값은 MOCK_PG_WEBHOOK_SECRET" })
  @ApiZodBody(webhookSchema, {
    eventId: "evt_7f3a9c",
    txId: "tx_0acb3a482c074bd0b6a01f9fd161bd1e",
    merchantTradeId: "P260929-000002",
    type: "APPROVED",
    amount: 10000,
    method: "CARD",
    failureCode: null,
    occurredAt: "2026-09-29T05:53:30.600Z",
  })
  @ApiOkResponse({
    description: "APPLIED · ALREADY_APPLIED · DUPLICATE_EVENT · UNKNOWN_PAYMENT · AMOUNT_MISMATCH · CONFLICT_STATE · UNHANDLED",
    example: { eventId: "evt_7f3a9c", result: "APPLIED" },
  })
  @ApiErrors(ErrorCode.UNAUTHORIZED, ErrorCode.VALIDATION_FAILED)
  handle(@Req() request: { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!request.rawBody) throw new ApiError(ErrorCode.BAD_REQUEST, "Empty webhook body.");
    return this.webhooks.handle(request.rawBody, headers);
  }
}
