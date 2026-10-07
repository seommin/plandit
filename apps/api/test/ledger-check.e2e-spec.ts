import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { LedgerCheckService } from "../src/credit/ledger-check.service";
import { LedgerService } from "../src/credit/ledger.service";
import { ledgerCheckIssues } from "../src/metrics/metrics";
import { checkLedger } from "../src/scripts/check-ledger";
import { LedgerCheckProcessor } from "../src/worker/ledger-check.processor";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("PLANDIT-12 ledger check (e2e)", () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let check: LedgerCheckService;
  let ownerId: string;
  let seq = 0;

  /** A fresh team workspace's credit account, so each test can look at its own account only. */
  const newAccount = async (name: string) => {
    const { body } = await as(app, ownerId).post("/workspaces").send({ name }).expect(201);
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId: body.workspace.id } });
    return { accountId: account.id, workspaceId: body.workspace.id as string };
  };
  const append = (accountId: string, type: "CHARGE" | "DEBIT" | "REFUND", amount: number) =>
    ledger.append({ accountId, type, amount, refType: "MANUAL", refId: `t${++seq}`, idempotencyKey: `TEST:${seq}:${type}` });
  const issuesOf = async (accountId: string) => (await check.run()).issues.filter((issue) => issue.accountId === accountId);
  const output = async () => {
    const lines: string[] = [];
    const code = await checkLedger((line) => lines.push(line));
    return { code, text: lines.join("\n") };
  };

  beforeAll(async () => {
    app = await createTestApp();
    ledger = app.get(LedgerService);
    check = new LedgerCheckService();
    await resetDatabase();
    ownerId = (await registerUser(app, "ledger-owner")).id;
  });

  afterAll(() => closeTestApp(app));

  it("a healthy ledger passes, and the command exits 0", async () => {
    const { accountId } = await newAccount("정상팀");
    await append(accountId, "CHARGE", 100);
    await append(accountId, "DEBIT", -30);
    await append(accountId, "REFUND", 10);

    const result = await check.run();
    expect(result.issues).toEqual([]);
    expect(result.entries).toBe(3);
    expect(await output()).toEqual({ code: 0, text: expect.stringContaining("이상 없음") });
  });

  it("checks taken while 40 debits commit never report a false mismatch", async () => {
    const { accountId } = await newAccount("동시팀");
    await append(accountId, "CHARGE", 100);

    const [, results] = await Promise.all([
      Promise.all(Array.from({ length: 40 }, () => append(accountId, "DEBIT", -1))),
      Promise.all(Array.from({ length: 8 }, () => check.run())),
    ]);
    results.forEach((result) => expect(result.issues).toEqual([]));
    expect((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(60n);
  });

  it("finds a cache that drifted from the ledger, names the account, and the command exits 1", async () => {
    const { accountId, workspaceId } = await newAccount("캐시팀");
    await append(accountId, "CHARGE", 50);
    await prisma.$executeRaw`UPDATE "CreditAccount" SET "balance" = "balance" + 5 WHERE "id" = ${accountId}`;

    expect(await issuesOf(accountId)).toEqual([{ kind: "CACHE_MISMATCH", accountId, workspaceId, cached: "55", ledgerSum: "50" }]);
    const { code, text } = await output();
    expect(code).toBe(1);
    expect(text).toContain(`잔액 캐시 불일치  계정 ${accountId}`);

    await ledger.recalculate(accountId); // the runbook's fix: rebuild the cache from the ledger
    expect(await issuesOf(accountId)).toEqual([]);
  });

  it("points at exactly the row whose balanceAfter breaks the running total", async () => {
    const { accountId } = await newAccount("연속성팀");
    await append(accountId, "CHARGE", 100);
    await append(accountId, "DEBIT", -10);
    // Ledger rows can't be updated or deleted (trigger), so a bad row can only come from a raw INSERT,
    // e.g. a hand-written "fix". This one says 90 after taking 5 from 90 (should be 85).
    const [bad] = await prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO "CreditLedger" ("accountId", "type", "amount", "balanceAfter", "refType", "refId", "idempotencyKey")
      VALUES (${accountId}, 'DEBIT', -5, 90, 'MANUAL', 'hand-fix', 'TEST:hand-fix') RETURNING "id"`;
    await prisma.$executeRaw`UPDATE "CreditAccount" SET "balance" = 85 WHERE "id" = ${accountId}`; // cache agrees with the sum

    expect(await issuesOf(accountId)).toEqual([
      expect.objectContaining({ kind: "BALANCE_AFTER_BREAK", ledgerId: bad.id.toString(), expected: "85", actual: "90" }),
    ]);
  });

  it("reports a negative running total, and the daily worker job publishes the counts", async () => {
    const { accountId } = await newAccount("음수팀");
    await prisma.$executeRaw`
      INSERT INTO "CreditLedger" ("accountId", "type", "amount", "balanceAfter", "refType", "refId", "idempotencyKey")
      VALUES (${accountId}, 'DEBIT', -3, -3, 'MANUAL', 'overdraw', 'TEST:overdraw')`;
    await prisma.$executeRaw`UPDATE "CreditAccount" SET "balance" = -3 WHERE "id" = ${accountId}`;

    expect(await issuesOf(accountId)).toEqual([expect.objectContaining({ kind: "NEGATIVE_BALANCE", expected: "-3", actual: "-3" })]);

    // Whole database now: the 연속성팀 break and this negative balance.
    expect(await new LedgerCheckProcessor(check).runOnce()).toEqual(expect.objectContaining({ issues: 2 }));
    const gauge = Object.fromEntries((await ledgerCheckIssues.get()).values.map((v) => [v.labels.kind, v.value]));
    expect(gauge).toEqual({ CACHE_MISMATCH: 0, BALANCE_AFTER_BREAK: 1, NEGATIVE_BALANCE: 1 });
  });
});
