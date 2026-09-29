import { Controller, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { OperatorGuard } from "../common/operator.guard";
import { ZodPipe } from "../common/zod";
import { LedgerService } from "../credit/ledger.service";
import { PaymentReconcileService } from "../payment/payment-reconcile.service";
import { ReminderDispatchService } from "../reminder/reminder-dispatch.service";

const ageQuery = z.object({ minAgeMs: z.coerce.number().int().min(0).optional() });

/**
 * Recovery commands from docs/runbook.md, for platform operators. They run the same code as the scheduled jobs,
 * but now and inside this request's trace id, so the resulting audit rows point back at the operator's call.
 */
@ApiTags("ops")
@UseGuards(OperatorGuard)
@Controller("admin")
export class OpsController {
  constructor(
    private readonly payments: PaymentReconcileService,
    private readonly reminders: ReminderDispatchService,
    private readonly ledger: LedgerService,
  ) {}

  @Post("jobs/payment-reconcile")
  @ApiQuery({ name: "minAgeMs", required: false, description: "default RECONCILE_MIN_AGE_MS; 0 = every unsettled payment" })
  reconcilePayments(@Query(new ZodPipe(ageQuery)) query: z.infer<typeof ageQuery>) {
    return this.payments.run(new Date(), query.minAgeMs);
  }

  @Post("jobs/reminder-reconcile")
  @ApiQuery({ name: "minAgeMs", required: false, description: "default RELAY_RESULT_TIMEOUT_MS" })
  reconcileReminders(@Query(new ZodPipe(ageQuery)) query: z.infer<typeof ageQuery>) {
    return this.reminders.reconcileSent(new Date(), query.minAgeMs);
  }

  @Post("credit-accounts/:accountId/recalculate")
  async recalculate(@Param("accountId") accountId: string) {
    const { before, after } = await this.ledger.recalculate(accountId);
    return { accountId, before: Number(before), after: Number(after) };
  }
}
