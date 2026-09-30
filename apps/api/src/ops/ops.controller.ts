import { Controller, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCreatedResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { AiUsageService } from "../ai/ai-usage.service";
import { ErrorCode } from "../common/api-error";
import { OperatorGuard } from "../common/operator.guard";
import { ApiErrors } from "../common/swagger";
import { ZodPipe } from "../common/zod";
import { LedgerService } from "../credit/ledger.service";
import { PaymentReconcileService } from "../payment/payment-reconcile.service";
import { ReminderDispatchService } from "../reminder/reminder-dispatch.service";

const ageQuery = z.object({ minAgeMs: z.coerce.number().int().min(0).optional() });

/**
 * Recovery commands from docs/runbook.md, for platform operators. They run the same code as the scheduled jobs,
 * but now and inside this request's trace id, so the resulting audit rows point back at the operator's call.
 */
@ApiTags("운영")
@ApiErrors(ErrorCode.FORBIDDEN)
@UseGuards(OperatorGuard)
@Controller("admin")
export class OpsController {
  constructor(
    private readonly payments: PaymentReconcileService,
    private readonly reminders: ReminderDispatchService,
    private readonly ledger: LedgerService,
    private readonly aiUsages: AiUsageService,
  ) {}

  @Post("jobs/payment-reconcile")
  @ApiOperation({
    summary: "결제 재조회 지금 실행",
    description:
      "예약 작업과 같은 코드를 지금 이 요청의 traceId로 돌린다. `minAgeMs`보다 오래된 RESERVE·UNKNOWN 결제를 최대 100건 PG에 재조회해 웹훅과 같은 전이·같은 원장 멱등키로 확정하므로, 뒤늦게 웹훅이 와도 두 번 지급되지 않는다. PG에 없으면 실패(PG_NOT_FOUND), PG에서 결제 전인 채로 PAYMENT_EXPIRE_AFTER_MS(기본 24시간)가 지나면 만료(EXPIRED).",
  })
  @ApiQuery({ name: "minAgeMs", required: false, description: "기본 RECONCILE_MIN_AGE_MS(5분). 0이면 확정 안 된 결제 전부" })
  @ApiCreatedResponse({ example: { checked: 2, approved: 1, failed: 0, expired: 0, pending: 1, settled: 0, mismatch: 0, errors: 0 } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  reconcilePayments(@Query(new ZodPipe(ageQuery)) query: z.infer<typeof ageQuery>) {
    return this.payments.run(new Date(), query.minAgeMs);
  }

  @Post("jobs/reminder-reconcile")
  @ApiOperation({
    summary: "발송 결과 재조회 지금 실행",
    description:
      "결과 웹훅이 오지 않아 `minAgeMs`보다 오래 SENT에 머문 발송을 최대 100건 중계사에 재조회해 DELIVERED/FAILED로 확정한다. 중계사에도 없으면 FAILED(RELAY_LOST). 실패 건은 발송 건 단위 멱등키로 한 번만 환불한다.",
  })
  @ApiQuery({ name: "minAgeMs", required: false, description: "기본 RELAY_RESULT_TIMEOUT_MS(10분)" })
  @ApiCreatedResponse({ example: { checked: 3, settled: 2, pending: 1, errors: 0 } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  reconcileReminders(@Query(new ZodPipe(ageQuery)) query: z.infer<typeof ageQuery>) {
    return this.reminders.reconcileSent(new Date(), query.minAgeMs);
  }

  @Post("jobs/ai-usage-reconcile")
  @ApiOperation({
    summary: "멈춘 AI 사용 건 정리 지금 실행",
    description:
      "`minAgeMs`보다 오래 RESERVED(생성 시각 기준)이거나 CALLING(호출 시작 기준)인 AI 사용 건을 최대 100건 FAILED(STALE)로 닫고 선차감 전액을 환불한다. 사용 건 단위 멱등키라 두 번 돌려도 환불은 한 번이고, 그 뒤에 모델 응답이 돌아와도 청구하지 않는다.",
  })
  @ApiQuery({ name: "minAgeMs", required: false, description: "기본 AI_USAGE_STALE_MS(30분)" })
  @ApiCreatedResponse({ example: { checked: 1, refunded: 1, errors: 0 } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  reconcileAiUsages(@Query(new ZodPipe(ageQuery)) query: z.infer<typeof ageQuery>) {
    return this.aiUsages.reconcileStale(new Date(), query.minAgeMs);
  }

  @Post("credit-accounts/:accountId/recalculate")
  @ApiOperation({
    summary: "잔액 캐시 다시 계산",
    description: "계정 행을 잠그고 잔액 캐시를 원장 합계로 다시 쓴다. 원장은 건드리지 않는다. `before`와 `after`가 다르면 캐시가 어긋나 있던 것이다.",
  })
  @ApiCreatedResponse({ example: { accountId: "cmum8usba000fekyjhc5ezy6d", before: 1299, after: 1299 } })
  @ApiErrors(ErrorCode.NOT_FOUND)
  async recalculate(@Param("accountId") accountId: string) {
    const { before, after } = await this.ledger.recalculate(accountId);
    return { accountId, before: Number(before), after: Number(after) };
  }
}
