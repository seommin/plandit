import { Inject, Injectable } from "@nestjs/common";

import { type Payment, Prisma, prisma } from "@plandit/database/prisma";
import { creditsForAmount } from "@plandit/shared/credits";

import { ApiError, ErrorCode } from "../common/api-error";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";
import { LedgerService } from "../credit/ledger.service";
import { PAYMENT_GATEWAY, type PaymentGateway, PaymentGatewayError } from "./payment-gateway";

const yymmdd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

export function toPaymentDto(payment: Payment) {
  return {
    id: payment.id,
    tradeId: payment.tradeId,
    status: payment.status,
    amount: payment.amount,
    credits: Number(payment.credits),
    paymentPageUrl: payment.paymentPageUrl,
    method: payment.method,
    failureCode: payment.failureCode,
    createdAt: payment.createdAt,
    approvedAt: payment.approvedAt,
    failedAt: payment.failedAt,
  };
}

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * 1) write the Payment as RESERVE  2) call the PG  3) store its tx id / page URL.
   * Step 1 is committed before step 2, so even if the PG call hangs or its response is lost we still have
   * the trade on record (UNKNOWN) for the re-query job to settle.
   */
  async charge(workspaceId: string, userId: string, amount: number) {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } });
    const [{ seq }] = await prisma.$queryRaw<{ seq: bigint }[]>`SELECT nextval('payment_trade_seq') AS seq`;
    const tradeId = `P${yymmdd.format(new Date()).replaceAll("-", "")}-${seq.toString().padStart(6, "0")}`;

    const payment = await prisma.payment.create({
      data: {
        workspaceId,
        accountId: account.id,
        tradeId,
        provider: this.gateway.provider,
        amount,
        credits: creditsForAmount(amount),
        requestedById: userId,
      },
    });

    try {
      const returnUrl = new URL("/credits/charge-result", process.env.WEB_ORIGIN ?? "http://localhost:3000");
      returnUrl.searchParams.set("workspaceId", workspaceId);
      returnUrl.searchParams.set("paymentId", payment.id);
      const reserved = await this.gateway.reserve({ tradeId, amount, returnUrl: returnUrl.toString() });
      return toPaymentDto(
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerTxId: reserved.providerTxId, paymentPageUrl: reserved.paymentPageUrl },
        }),
      );
    } catch (error) {
      if (!(error instanceof PaymentGatewayError)) throw error;
      const failed = await prisma.payment.update({
        where: { id: payment.id },
        data: error.retryable
          ? { status: "UNKNOWN", failureMessage: error.message }
          : { status: "FAILED", failureCode: "PG_REJECTED", failureMessage: error.message, failedAt: new Date() },
      });
      throw new ApiError(ErrorCode.PAYMENT_GATEWAY_ERROR, "The payment gateway is not available. Please try again.", {
        paymentId: failed.id,
        status: failed.status,
      });
    }
  }

  /**
   * RESERVE/UNKNOWN → APPROVED with the CHARGE ledger row, inside the caller's transaction.
   * Shared by the webhook and (PLANDIT-6) the re-query job; the ledger key makes a second call harmless.
   */
  async applyApproval(
    tx: Prisma.TransactionClient,
    payment: Payment,
    info: { providerTxId: string; method: string | null; approvedAt: Date },
  ) {
    const { entry } = await this.ledger.append(
      {
        accountId: payment.accountId,
        type: "CHARGE",
        amount: payment.credits,
        refType: "PAYMENT",
        refId: payment.id,
        idempotencyKey: `PAYMENT:${payment.id}:CHARGE`,
      },
      tx,
    );
    return tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "APPROVED",
        providerTxId: info.providerTxId,
        method: info.method,
        approvedAt: info.approvedAt,
        ledgerId: entry.id,
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  async list(workspaceId: string, page: PageQuery) {
    const rows = await prisma.payment.findMany({ where: { workspaceId }, ...pageArgs(page) });
    const { items, nextCursor } = toPage(rows, page.limit, (row) => row.id);
    return { items: items.map(toPaymentDto), nextCursor };
  }

  async get(workspaceId: string, paymentId: string) {
    const payment = await prisma.payment.findFirst({ where: { id: paymentId, workspaceId } });
    if (!payment) throw new ApiError(ErrorCode.NOT_FOUND, "Payment not found.");
    return toPaymentDto(payment);
  }
}
