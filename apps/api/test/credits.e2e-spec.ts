import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { ApiError } from "../src/common/api-error";
import { LedgerService } from "../src/credit/ledger.service";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("PLANDIT-3 credit ledger (e2e)", () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let operator: { id: string; email: string };
  let workspaceId: string;
  let accountId: string;
  let seq = 0;
  const key = (label: string) => `TEST:${label}:${++seq}`;

  const charge = (amount: number) =>
    ledger.append({ accountId, type: "CHARGE", amount, refType: "PAYMENT", refId: `p${seq}`, idempotencyKey: key("charge") });

  beforeAll(async () => {
    app = await createTestApp();
    ledger = app.get(LedgerService);
    await resetDatabase();
    [owner, member, operator] = await Promise.all(["owner", "member", "operator"].map((n) => registerUser(app, n)));
    process.env.PLATFORM_ADMIN_EMAILS = operator.email;

    const team = await as(app, owner.id).post("/workspaces").send({ name: "결제팀" }).expect(201);
    workspaceId = team.body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: member.email }).expect(201);
    accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
  });

  afterAll(() => closeTestApp(app));

  describe("LedgerService.append", () => {
    it("charges and debits, recording balanceAfter and keeping the cache in sync", async () => {
      const charged = await charge(100);
      expect(charged.entry.balanceAfter).toBe(100n);

      const debited = await ledger.append({
        accountId, type: "DEBIT", amount: -30, refType: "REMINDER_DELIVERY", refId: "d1", idempotencyKey: key("debit"),
      });
      expect(debited.entry.balanceAfter).toBe(70n);
      expect((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(70n);
    });

    it("refuses a debit larger than the balance and writes nothing", async () => {
      const before = await prisma.creditLedger.count();
      await expect(
        ledger.append({ accountId, type: "DEBIT", amount: -71, refType: "REMINDER_DELIVERY", refId: "d2", idempotencyKey: key("big") }),
      ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
      expect(await prisma.creditLedger.count()).toBe(before);
      expect((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(70n);
    });

    it("replays the same idempotency key without side effects", async () => {
      const input = { accountId, type: "CHARGE" as const, amount: 5, refType: "PAYMENT" as const, refId: "p-idem", idempotencyKey: "PAYMENT:p-idem:CHARGE" };
      const first = await ledger.append(input);
      const second = await ledger.append(input);
      expect(second.replayed).toBe(true);
      expect(second.entry.id).toBe(first.entry.id);
      expect((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(75n);
    });

    it("rejects a reused key that describes a different movement", async () => {
      await expect(
        ledger.append({ accountId, type: "CHARGE", amount: 999, refType: "PAYMENT", refId: "p-idem", idempotencyKey: "PAYMENT:p-idem:CHARGE" }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    });

    it("the database itself rejects UPDATE and DELETE on the ledger", async () => {
      await expect(prisma.$executeRaw`UPDATE "CreditLedger" SET "amount" = 0`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM "CreditLedger"`).rejects.toThrow(/append-only/);
    });
  });

  describe("concurrency", () => {
    it("50 concurrent debits of 1 against a balance of 30 → exactly 30 succeed", async () => {
      const personal = await prisma.workspace.findUniqueOrThrow({
        where: { personalOwnerId: member.id },
        include: { creditAccount: true },
      });
      const account = personal.creditAccount!.id;
      await ledger.append({ accountId: account, type: "CHARGE", amount: 30, refType: "PAYMENT", refId: "seed", idempotencyKey: "PAYMENT:seed:CHARGE" });

      const results = await Promise.allSettled(
        Array.from({ length: 50 }, (_, i) =>
          ledger.append({ accountId: account, type: "DEBIT", amount: -1, refType: "REMINDER_DELIVERY", refId: `c${i}`, idempotencyKey: `REMINDER_DELIVERY:c${i}:DEBIT` }),
        ),
      );

      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(30);
      expect(failed.every((r) => r.reason instanceof ApiError && r.reason.code === "INSUFFICIENT_CREDITS")).toBe(true);

      const debits = await prisma.creditLedger.findMany({ where: { accountId: account, type: "DEBIT" }, orderBy: { id: "asc" } });
      expect(debits).toHaveLength(30);
      debits.forEach((row, i) => expect(row.balanceAfter).toBe(BigInt(29 - i)));

      const [{ sum }] = await prisma.$queryRaw<{ sum: bigint }[]>`
        SELECT SUM("amount")::bigint AS sum FROM "CreditLedger" WHERE "accountId" = ${account}`;
      const cached = await prisma.creditAccount.findUniqueOrThrow({ where: { id: account } });
      expect(cached.balance).toBe(0n);
      expect(sum).toBe(cached.balance);
    });
  });

  describe("recalculate", () => {
    it("rebuilds a drifted cache from the ledger sum", async () => {
      await prisma.$executeRaw`UPDATE "CreditAccount" SET "balance" = 12345 WHERE "id" = ${accountId}`;
      const { before, after } = await ledger.recalculate(accountId);
      expect(before).toBe(12345n);
      expect(after).toBe(75n);
    });
  });

  describe("HTTP API", () => {
    it("any member can read the balance", async () => {
      const response = await as(app, member.id).get(`/workspaces/${workspaceId}/credits`).expect(200);
      expect(response.body).toMatchObject({ accountId, balance: 75 });
    });

    it("the ledger is ADMIN+ only, newest first, filterable and paginated", async () => {
      await as(app, member.id).get(`/workspaces/${workspaceId}/credits/ledger`).expect(403);

      const page1 = await as(app, owner.id).get(`/workspaces/${workspaceId}/credits/ledger?limit=2`).expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(Number(page1.body.items[0].id)).toBeGreaterThan(Number(page1.body.items[1].id));
      const page2 = await as(app, owner.id)
        .get(`/workspaces/${workspaceId}/credits/ledger?limit=2&cursor=${page1.body.nextCursor}`)
        .expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.nextCursor).toBeNull();

      const debits = await as(app, owner.id).get(`/workspaces/${workspaceId}/credits/ledger?type=DEBIT`).expect(200);
      expect(debits.body.items.map((e: { type: string }) => e.type)).toEqual(["DEBIT"]);
    });

    it("manual adjustment: operators only, memo and Idempotency-Key required, retries are no-ops", async () => {
      const url = `/admin/workspaces/${workspaceId}/credits/adjustments`;
      await as(app, owner.id).post(url).set("idempotency-key", "adjust-0001").send({ amount: 10, memo: "보상" }).expect(403);
      await as(app, operator.id).post(url).set("idempotency-key", "adjust-0001").send({ amount: 10 }).expect(400);
      await as(app, operator.id).post(url).send({ amount: 10, memo: "보상" }).expect(400);

      const first = await as(app, operator.id).post(url).set("idempotency-key", "adjust-0001").send({ amount: 10, memo: "보상" }).expect(201);
      const retry = await as(app, operator.id).post(url).set("idempotency-key", "adjust-0001").send({ amount: 10, memo: "보상" }).expect(201);
      expect(first.body.entry).toMatchObject({ type: "ADJUST", amount: 10, balanceAfter: 85, createdById: operator.id });
      expect(retry.body).toMatchObject({ replayed: true, entry: { id: first.body.entry.id } });
    });
  });
});
