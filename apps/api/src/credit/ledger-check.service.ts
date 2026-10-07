import { Injectable } from "@nestjs/common";

import { Prisma, prisma } from "@plandit/database/prisma";

/**
 * - CACHE_MISMATCH: `CreditAccount.balance` (the cache) ≠ the sum of that account's ledger.
 * - BALANCE_AFTER_BREAK: a row's `balanceAfter` ≠ the running total of the account's amounts up to that row.
 *   Compared with the running total (not the previous row), so one bad row is reported once, not twice.
 * - NEGATIVE_BALANCE: a running total below zero, which append() never allows.
 */
export type LedgerIssue =
  | { kind: "CACHE_MISMATCH"; accountId: string; workspaceId: string; cached: string; ledgerSum: string }
  | { kind: "BALANCE_AFTER_BREAK" | "NEGATIVE_BALANCE"; accountId: string; workspaceId: string; ledgerId: string; expected: string; actual: string };

export type LedgerCheckResult = { accounts: number; entries: number; issues: LedgerIssue[]; truncated: boolean };

/** Report at most this many rows per check; a broken ledger is broken whether we list 1,000 rows or a million. */
const MAX_ROWS = 1_000;

@Injectable()
export class LedgerCheckService {
  /**
   * Read-only. Each check is a single SQL statement, and a statement reads one snapshot, so an append committing
   * mid-check (cache update + ledger row in one transaction) is either fully visible or not — live traffic never
   * shows up as a false mismatch. Keep it that way: comparing a balance read in one query with a sum read in
   * another would race. REPEATABLE READ only makes the counts and both checks come from the same moment.
   */
  run(): Promise<LedgerCheckResult> {
    return prisma.$transaction(
      async (tx) => {
        const [counts] = await tx.$queryRaw<{ accounts: number; entries: number }[]>`
          SELECT (SELECT COUNT(*) FROM "CreditAccount")::int AS "accounts",
                 (SELECT COUNT(*) FROM "CreditLedger")::int AS "entries"`;

        const cache = await tx.$queryRaw<{ accountId: string; workspaceId: string; cached: bigint; ledgerSum: bigint }[]>`
          SELECT a."id" AS "accountId", a."workspaceId", a."balance" AS "cached", COALESCE(SUM(l."amount"), 0)::bigint AS "ledgerSum"
          FROM "CreditAccount" a
          LEFT JOIN "CreditLedger" l ON l."accountId" = a."id"
          GROUP BY a."id"
          HAVING a."balance" <> COALESCE(SUM(l."amount"), 0)
          ORDER BY a."id"
          LIMIT ${MAX_ROWS + 1}`;

        // Ledger ids come from one sequence and appends to an account are serialized by its row lock,
        // so id order is append order within an account.
        const rows = await tx.$queryRaw<{ ledgerId: bigint; accountId: string; workspaceId: string; expected: bigint; actual: bigint }[]>`
          SELECT "ledgerId", "accountId", "workspaceId", "expected", "actual"
          FROM (
            SELECT l."id" AS "ledgerId", l."accountId", a."workspaceId", l."balanceAfter" AS "actual",
                   SUM(l."amount") OVER (PARTITION BY l."accountId" ORDER BY l."id" ROWS UNBOUNDED PRECEDING)::bigint AS "expected"
            FROM "CreditLedger" l
            JOIN "CreditAccount" a ON a."id" = l."accountId"
          ) running
          WHERE "actual" <> "expected" OR "expected" < 0
          ORDER BY "accountId", "ledgerId"
          LIMIT ${MAX_ROWS + 1}`;

        const issues: LedgerIssue[] = [
          ...cache.slice(0, MAX_ROWS).map((row) => ({
            kind: "CACHE_MISMATCH" as const,
            accountId: row.accountId,
            workspaceId: row.workspaceId,
            cached: row.cached.toString(),
            ledgerSum: row.ledgerSum.toString(),
          })),
          ...rows.slice(0, MAX_ROWS).map((row) => ({
            kind: row.expected < 0n ? ("NEGATIVE_BALANCE" as const) : ("BALANCE_AFTER_BREAK" as const),
            accountId: row.accountId,
            workspaceId: row.workspaceId,
            ledgerId: row.ledgerId.toString(),
            expected: row.expected.toString(),
            actual: row.actual.toString(),
          })),
        ];
        return { ...counts, issues, truncated: cache.length > MAX_ROWS || rows.length > MAX_ROWS };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
    );
  }
}
