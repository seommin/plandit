import { Inject, Injectable, Logger } from "@nestjs/common";

import { Prisma, prisma } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { PAYMENT_GATEWAY, type PaymentGateway, type PaymentWebhookEvent } from "./payment-gateway";
import { PaymentService } from "./payment.service";

export type WebhookResult =
  | "APPLIED"
  | "ALREADY_APPLIED"
  | "DUPLICATE_EVENT"
  | "UNKNOWN_PAYMENT"
  | "AMOUNT_MISMATCH"
  | "CONFLICT_STATE"
  | "UNHANDLED";

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentService,
  ) {}

  /**
   * Signature → store event (eventId unique) → lock payment → state transition → ledger, all in one transaction.
   * A repeated eventId stops at step 2. A different eventId for an already-approved payment stops at the state
   * check, and even past it the ledger idempotency key would keep the CHARGE at one row.
   * Throwing (→ 5xx) rolls everything back so the PG's retry can be processed cleanly.
   */
  async handle(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = this.gateway.parseWebhook(rawBody, headers);
    if (!event) throw new ApiError(ErrorCode.UNAUTHORIZED, "Invalid webhook signature.");

    return prisma.$transaction(
      async (tx) => {
        const { count } = await tx.paymentEvent.createMany({
          data: [
            {
              eventId: event.eventId,
              eventType: event.type,
              payload: event.raw as Prisma.InputJsonValue,
              result: "PENDING",
            },
          ],
          skipDuplicates: true,
        });
        if (count === 0) return { eventId: event.eventId, result: "DUPLICATE_EVENT" as WebhookResult };

        const { result, paymentId } = await this.apply(tx, event);
        await tx.paymentEvent.update({ where: { eventId: event.eventId }, data: { result, paymentId } });
        return { eventId: event.eventId, result };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  private async apply(
    tx: Prisma.TransactionClient,
    event: PaymentWebhookEvent,
  ): Promise<{ result: WebhookResult; paymentId: string | null }> {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Payment" WHERE "tradeId" = ${event.tradeId} FOR UPDATE`;
    if (!locked) {
      this.logger.warn({ eventId: event.eventId, tradeId: event.tradeId }, "Webhook for unknown trade");
      return { result: "UNKNOWN_PAYMENT", paymentId: null };
    }

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: locked.id } });
    const done = (result: WebhookResult) => ({ result, paymentId: payment.id });

    if (payment.amount !== event.amount) {
      this.logger.error({ eventId: event.eventId, paymentId: payment.id, expected: payment.amount, got: event.amount }, "Webhook amount mismatch");
      return done("AMOUNT_MISMATCH");
    }
    const open = payment.status === "RESERVE" || payment.status === "UNKNOWN";

    switch (event.type) {
      case "APPROVED":
        if (payment.status === "APPROVED") return done("ALREADY_APPLIED");
        if (!open) {
          // Money taken after we gave up on the payment: needs an operator (see runbook).
          this.logger.error({ eventId: event.eventId, paymentId: payment.id, status: payment.status }, "APPROVED webhook for a closed payment");
          return done("CONFLICT_STATE");
        }
        await this.payments.applyApproval(tx, payment, {
          providerTxId: event.providerTxId,
          method: event.method,
          approvedAt: event.occurredAt,
          source: "webhook",
        });
        return done("APPLIED");

      case "FAILED":
        if (payment.status === "FAILED") return done("ALREADY_APPLIED");
        if (!open) return done("CONFLICT_STATE");
        await this.payments.applyFailure(tx, payment, {
          status: "FAILED",
          failureCode: event.failureCode ?? "UNKNOWN",
          providerTxId: event.providerTxId,
          at: event.occurredAt,
          source: "webhook",
        });
        return done("APPLIED");

      case "CANCELED":
        // Refund flow (REFUND ledger row) is PLANDIT-31; until then the event is stored for an operator.
        this.logger.warn({ eventId: event.eventId, paymentId: payment.id }, "CANCELED webhook not handled yet");
        return done("UNHANDLED");
    }
  }
}
