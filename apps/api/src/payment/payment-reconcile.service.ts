import { Inject, Injectable, Logger } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { PAYMENT_GATEWAY, type PaymentGateway } from "./payment-gateway";
import { PaymentService } from "./payment.service";

export type ReconcileOutcome = "approved" | "failed" | "expired" | "pending" | "settled" | "mismatch";
export type ReconcileSummary = Record<ReconcileOutcome | "checked" | "errors", number>;

const minutes = (n: number) => n * 60_000;

/**
 * Settles payments the webhook never settled: RESERVE older than RECONCILE_MIN_AGE_MS (webhook lost or late)
 * and UNKNOWN (our reserve call timed out). Asks the PG, then applies the same transitions as the webhook,
 * sharing PaymentService.applyApproval() and its ledger key, so a webhook arriving later changes nothing.
 */
@Injectable()
export class PaymentReconcileService {
  private readonly logger = new Logger(PaymentReconcileService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentService,
  ) {}

  private get minAgeMs() {
    return Number(process.env.RECONCILE_MIN_AGE_MS ?? minutes(5));
  }

  private get expireAfterMs() {
    return Number(process.env.PAYMENT_EXPIRE_AFTER_MS ?? minutes(24 * 60));
  }

  /** `minAgeMs` override: an operator forcing a run (runbook) may pass 0. */
  async run(now = new Date(), minAgeMs = this.minAgeMs): Promise<ReconcileSummary> {
    const due = await prisma.payment.findMany({
      where: { status: { in: ["RESERVE", "UNKNOWN"] }, createdAt: { lte: new Date(now.getTime() - minAgeMs) } },
      orderBy: { createdAt: "asc" },
      take: 100, // ponytail: one batch per tick; raise or loop if the backlog ever exceeds 100/minute
      select: { id: true },
    });

    const summary: ReconcileSummary = { checked: 0, approved: 0, failed: 0, expired: 0, pending: 0, settled: 0, mismatch: 0, errors: 0 };
    for (const { id } of due) {
      summary.checked++;
      try {
        summary[await this.reconcileOne(id, now)]++;
      } catch (error) {
        summary.errors++;
        this.logger.error({ paymentId: id, err: error }, "Payment reconcile failed");
      }
    }
    if (summary.checked) this.logger.log(summary, "Payment reconcile finished");
    return summary;
  }

  async reconcileOne(paymentId: string, now = new Date()): Promise<ReconcileOutcome> {
    const { tradeId } = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { tradeId: true } });
    const found = await this.gateway.lookup(tradeId); // external call stays outside the transaction

    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        if (payment.status !== "RESERVE" && payment.status !== "UNKNOWN") return "settled"; // webhook won the race

        if (found && found.amount !== payment.amount) {
          this.logger.error({ paymentId, expected: payment.amount, got: found.amount }, "PG amount mismatch on re-query");
          return "mismatch";
        }

        switch (found?.status) {
          case "APPROVED":
            await this.payments.applyApproval(tx, payment, {
              providerTxId: found.providerTxId,
              method: found.method,
              approvedAt: found.approvedAt ?? now,
              source: "reconcile",
            });
            return "approved";
          case "FAILED":
          case "CANCELED":
            await this.payments.applyFailure(tx, payment, {
              status: found.status,
              failureCode: found.failureCode ?? found.status,
              providerTxId: found.providerTxId,
              at: now,
              source: "reconcile",
            });
            return "failed";
        }

        // The PG never saw it (our reserve never arrived): nobody can pay it, so it's safe to close.
        if (!found) {
          await this.payments.applyFailure(tx, payment, { status: "FAILED", failureCode: "PG_NOT_FOUND", at: now, source: "reconcile" });
          return "failed";
        }

        // READY at the PG: the user hasn't paid (yet). Give up after the expiry window.
        if (now.getTime() - payment.createdAt.getTime() >= this.expireAfterMs) {
          await this.payments.applyFailure(tx, payment, { status: "FAILED", failureCode: "EXPIRED", at: now, source: "reconcile" });
          return "expired";
        }
        return "pending";
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }
}
