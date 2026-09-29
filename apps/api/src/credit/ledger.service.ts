import { Injectable } from "@nestjs/common";

import {
  type CreditLedger,
  type LedgerRefType,
  type LedgerType,
  Prisma,
  prisma,
} from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { ledgerAppends } from "../metrics/metrics";

export type AppendInput = {
  accountId: string;
  type: LedgerType;
  /** Signed credits: CHARGE/REFUND > 0, DEBIT < 0, ADJUST ≠ 0. */
  amount: bigint | number;
  refType: LedgerRefType;
  refId: string;
  /** Convention: `${refType}:${refId}:${type}`. Same key twice → the first row is returned, nothing changes. */
  idempotencyKey: string;
  memo?: string;
  createdById?: string;
};

export type AppendResult = { entry: CreditLedger; replayed: boolean };

type Tx = Prisma.TransactionClient;

export function assertAmountSign(type: LedgerType, amount: bigint) {
  const ok =
    type === "CHARGE" || type === "REFUND" ? amount > 0n : type === "DEBIT" ? amount < 0n : amount !== 0n;
  if (!ok) throw new ApiError(ErrorCode.BAD_REQUEST, `Invalid amount ${amount} for ${type}.`);
}

@Injectable()
export class LedgerService {
  /**
   * The only way credits move. Inside one transaction:
   * lock the account row → (re)check the idempotency key → update the cached balance in SQL
   * (`balance + amount`, refused if it would go negative) → insert the ledger row with that balance.
   * Pass `tx` to join a caller's transaction (e.g. webhook event + ledger in one commit).
   */
  append(input: AppendInput, tx?: Tx): Promise<AppendResult> {
    const amount = BigInt(input.amount);
    assertAmountSign(input.type, amount);

    const run = tx
      ? this.appendIn(tx, { ...input, amount })
      : prisma.$transaction((t) => this.appendIn(t, { ...input, amount }), { maxWait: 10_000, timeout: 10_000 });
    return run.then(
      (result) => {
        ledgerAppends.inc({ type: input.type, outcome: result.replayed ? "replayed" : "applied" });
        return result;
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.code === ErrorCode.INSUFFICIENT_CREDITS) {
          ledgerAppends.inc({ type: input.type, outcome: "insufficient" });
        }
        throw error;
      },
    );
  }

  private async appendIn(tx: Tx, input: AppendInput & { amount: bigint }): Promise<AppendResult> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CreditAccount" WHERE "id" = ${input.accountId} FOR UPDATE`;
    if (!locked.length) throw new ApiError(ErrorCode.NOT_FOUND, "Credit account not found.");

    const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { entry: this.assertSameRequest(existing, input), replayed: true };

    const updated = await tx.$queryRaw<{ balance: bigint }[]>`
      UPDATE "CreditAccount"
      SET "balance" = "balance" + ${input.amount}, "updatedAt" = NOW()
      WHERE "id" = ${input.accountId} AND "balance" + ${input.amount} >= 0
      RETURNING "balance"`;
    if (!updated.length) {
      throw new ApiError(ErrorCode.INSUFFICIENT_CREDITS, "Not enough credits.", {
        required: Number(-input.amount),
      });
    }

    const entry = await tx.creditLedger.create({
      data: {
        accountId: input.accountId,
        type: input.type,
        amount: input.amount,
        balanceAfter: updated[0].balance,
        refType: input.refType,
        refId: input.refId,
        idempotencyKey: input.idempotencyKey,
        memo: input.memo,
        createdById: input.createdById,
      },
    });
    return { entry, replayed: false };
  }

  /** A reused key must describe the same movement; otherwise it's a caller bug, not a retry. */
  private assertSameRequest(existing: CreditLedger, input: AppendInput & { amount: bigint }) {
    if (
      existing.accountId !== input.accountId ||
      existing.type !== input.type ||
      existing.amount !== input.amount ||
      existing.refType !== input.refType ||
      existing.refId !== input.refId
    ) {
      throw new ApiError(ErrorCode.IDEMPOTENCY_CONFLICT, "Idempotency key was already used for a different entry.");
    }
    return existing;
  }

  /** Operations tool: rebuilds the cached balance from the ledger sum. Returns before/after. */
  recalculate(accountId: string) {
    return prisma.$transaction(async (tx) => {
      const [before] = await tx.$queryRaw<{ balance: bigint }[]>`
        SELECT "balance" FROM "CreditAccount" WHERE "id" = ${accountId} FOR UPDATE`;
      if (!before) throw new ApiError(ErrorCode.NOT_FOUND, "Credit account not found.");
      const [after] = await tx.$queryRaw<{ balance: bigint }[]>`
        UPDATE "CreditAccount"
        SET "balance" = COALESCE((SELECT SUM("amount") FROM "CreditLedger" WHERE "accountId" = ${accountId}), 0),
            "updatedAt" = NOW()
        WHERE "id" = ${accountId}
        RETURNING "balance"`;
      return { before: before.balance, after: after.balance };
    });
  }
}
