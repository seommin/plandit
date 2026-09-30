import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { prisma } from "@plandit/database/prisma";

import { type ExecuteHooks, AiUsageService } from "../src/ai/ai-usage.service";
import { LLM_CLIENT, type LlmRequest, type LlmResult } from "../src/ai/llm-client";
import { MOCK_MODEL, type MockLlmAdapter } from "../src/ai/mock-llm.adapter";
import { LedgerService } from "../src/credit/ledger.service";
import { WorkerModule } from "../src/worker/worker.module";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase, waitFor } from "./helpers";

describe("PLANDIT-20 AI usage metering (e2e)", () => {
  let app: INestApplication;
  let usages: AiUsageService;
  let llm: MockLlmAdapter;
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let outsider: { id: string; email: string };
  let operator: { id: string; email: string };
  let workspaceId: string;
  let accountId: string;

  const request: LlmRequest = {
    system: "당신은 일정 비서예요.",
    messages: [{ role: "user", content: "다음 주 회의를 정리해 주세요." }],
    maxOutputTokens: 4_000,
  };
  const text: ExecuteHooks<string> = { parse: (result: LlmResult) => result.text };
  const input = () => ({ workspaceId, userId: owner.id, feature: "SCHEDULE_ASSISTANT" as const, request });

  const balance = async () => Number((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance);
  const rows = async (usageId: string) =>
    (await prisma.creditLedger.findMany({ where: { refType: "AI_USAGE", refId: usageId }, orderBy: { id: "asc" } })).map((r) => ({
      type: r.type,
      amount: Number(r.amount),
      key: r.idempotencyKey,
    }));
  const usage = (id: string) => prisma.aiUsage.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await createTestApp();
    usages = app.get(AiUsageService);
    llm = app.get(LLM_CLIENT);
    await resetDatabase();
    [owner, member, outsider, operator] = await Promise.all(["owner", "member", "outsider", "operator"].map((n) => registerUser(app, n)));
    process.env.PLATFORM_ADMIN_EMAILS = operator.email;

    const team = await as(app, owner.id).post("/workspaces").send({ name: "AI팀" }).expect(201);
    workspaceId = team.body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: member.email }).expect(201);
    accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
    await app.get(LedgerService).append({ accountId, type: "CHARGE", amount: 1_000, refType: "PAYMENT", refId: "seed", idempotencyKey: "PAYMENT:seed:CHARGE" });
  });

  beforeEach(() => llm.reset());

  afterAll(() => closeTestApp(app));

  it("reserves the maximum, charges the actual usage and gives the rest back (DEBIT + ADJUST)", async () => {
    const start = await balance();
    const reserved = await usages.reserve(input());
    expect(reserved).toMatchObject({ status: "RESERVED", provider: "mock", maxOutputTokens: 4_000 });
    expect(reserved.estimatedCredits).toBe(usages.estimate(request));
    expect(await balance()).toBe(start - reserved.estimatedCredits);

    const seen: string[] = [];
    const outcome = await usages.execute(reserved.id, request, {
      ...text,
      onSuccess: async (_tx, output, settled) => void seen.push(`${output}:${settled.status}`),
    });

    expect(outcome.status).toBe("SUCCEEDED");
    expect(seen).toEqual(["모의 응답이에요.:SUCCEEDED"]);
    const done = await usage(reserved.id);
    expect(done).toMatchObject({ status: "SUCCEEDED", model: MOCK_MODEL, failureCode: null });
    expect(done.credits).toBeGreaterThanOrEqual(1);
    expect(done.credits).toBeLessThan(done.estimatedCredits);
    expect(done.outputTokens).toBeGreaterThan(0);
    expect(done.startedAt).not.toBeNull();

    expect(await rows(reserved.id)).toEqual([
      { type: "DEBIT", amount: -done.estimatedCredits, key: `AI_USAGE:${reserved.id}:DEBIT` },
      { type: "ADJUST", amount: done.estimatedCredits - done.credits, key: `AI_USAGE:${reserved.id}:ADJUST` },
    ]);
    expect(await balance()).toBe(start - done.credits);
    expect(llm.calls).toBe(1);
  });

  it("never charges more than the reservation, even when the model used more", async () => {
    const start = await balance();
    llm.enqueue({ attempts: [{ model: MOCK_MODEL, inputTokens: 10, outputTokens: 1_000_000, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }] });
    const outcome = await usages.run(input(), text);

    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.usage.credits).toBe(outcome.usage.estimatedCredits);
    expect(outcome.usage.outputTokens).toBe(1_000_000); // recorded as used, even though not charged
    expect((await rows(outcome.usage.id)).map((r) => r.type)).toEqual(["DEBIT"]);
    expect(await balance()).toBe(start - outcome.usage.estimatedCredits);
  });

  it.each([
    ["the model call fails", () => llm.enqueue({ error: "LLM_OVERLOADED" }), text, "LLM_OVERLOADED", false],
    ["the model refuses", () => llm.enqueue({ stopReason: "refusal", text: "" }), text, "LLM_REFUSED", true],
    ["the reply is cut off", () => llm.enqueue({ stopReason: "max_tokens" }), text, "LLM_TRUNCATED", true],
    [
      "the reply does not parse",
      () => llm.enqueue({ text: "not json" }),
      { parse: (r: LlmResult) => JSON.parse(r.text) as unknown },
      "INVALID_OUTPUT",
      true,
    ],
  ])("refunds the whole reservation when %s", async (_label, script, hooks, code, tokensRecorded) => {
    const start = await balance();
    script();
    const outcome = await usages.run(input(), hooks as ExecuteHooks<unknown>);

    expect(outcome).toMatchObject({ status: "FAILED", code });
    const failed = await usage(outcome.usage.id);
    expect(failed).toMatchObject({ status: "FAILED", failureCode: code, credits: 0 });
    expect(failed.outputTokens > 0 || failed.inputTokens > 0).toBe(tokensRecorded);
    expect(await rows(failed.id)).toEqual([
      { type: "DEBIT", amount: -failed.estimatedCredits, key: `AI_USAGE:${failed.id}:DEBIT` },
      { type: "REFUND", amount: failed.estimatedCredits, key: `AI_USAGE:${failed.id}:REFUND` },
    ]);
    expect(await balance()).toBe(start);
  });

  it("refuses when credits run short: 409, no usage row, the model is never called", async () => {
    const empty = await as(app, owner.id).post("/workspaces").send({ name: "빈 팀" }).expect(201);
    const emptyId = empty.body.workspace.id;

    await expect(usages.run({ ...input(), workspaceId: emptyId }, text)).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(await prisma.aiUsage.count({ where: { workspaceId: emptyId } })).toBe(0);
    expect(llm.calls).toBe(0);
  });

  it("rejects an output cap above what one non-streaming call may ask for", () => {
    expect(() => usages.estimate({ ...request, maxOutputTokens: 16_001 })).toThrow(/maxOutputTokens/);
  });

  it("calls the model once however many times, or however concurrently, execute() runs", async () => {
    const reserved = await usages.reserve(input());
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => usages.execute(reserved.id, request, text)));
    expect(outcomes.filter((o) => o.status === "SUCCEEDED")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "SKIPPED")).toHaveLength(4);
    expect(await usages.execute(reserved.id, request, text)).toMatchObject({ status: "SKIPPED" });
    expect(llm.calls).toBe(1);
    expect((await rows(reserved.id)).map((r) => r.type)).toEqual(["DEBIT", "ADJUST"]);
  });

  it("rolls the charge back with the feature's own write when onSuccess throws, and refunds instead", async () => {
    const start = await balance();
    const failures: string[] = [];
    const outcome = await usages.run(input(), {
      ...text,
      onSuccess: async (tx, _output, settled) => {
        await tx.aiUsage.update({ where: { id: settled.id }, data: { latencyMs: 999_999 } });
        throw new Error("feature write failed");
      },
      onFailure: async (_tx, code) => void failures.push(code),
    });

    expect(outcome).toMatchObject({ status: "FAILED", code: "INTERNAL" });
    expect(failures).toEqual(["INTERNAL"]);
    expect((await usage(outcome.usage.id)).latencyMs).not.toBe(999_999);
    expect((await rows(outcome.usage.id)).map((r) => r.type)).toEqual(["DEBIT", "REFUND"]);
    expect(await balance()).toBe(start);
  });

  it("leaves no DEBIT behind when the caller's transaction that reserved rolls back", async () => {
    const start = await balance();
    const before = await prisma.aiUsage.count({ where: { workspaceId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await usages.reserve(input(), tx);
        throw new Error("feature insert failed");
      }),
    ).rejects.toThrow("feature insert failed");
    expect(await prisma.aiUsage.count({ where: { workspaceId } })).toBe(before);
    expect(await balance()).toBe(start);
  });

  describe("stale sweep", () => {
    it("refunds a usage stuck in CALLING once, and a reply arriving afterwards is not charged", async () => {
      const start = await balance();
      let release!: () => void;
      llm.enqueue({ wait: new Promise<void>((resolve) => (release = resolve)) });
      const reserved = await usages.reserve(input());
      const inFlight = usages.execute(reserved.id, request, text);
      await waitFor(async () => (await usage(reserved.id)).status === "CALLING");

      expect(await usages.reconcileStale(new Date(), 0)).toEqual({ checked: 1, refunded: 1, errors: 0 });
      expect(await usages.reconcileStale(new Date(), 0)).toEqual({ checked: 0, refunded: 0, errors: 0 });

      release();
      expect(await inFlight).toMatchObject({ status: "FAILED", code: "STALE" });
      expect(await usage(reserved.id)).toMatchObject({ status: "FAILED", failureCode: "STALE", credits: 0 });
      expect((await rows(reserved.id)).map((r) => r.type)).toEqual(["DEBIT", "REFUND"]);
      expect(await balance()).toBe(start);
    });

    it("leaves fresh reservations alone until AI_USAGE_STALE_MS passes", async () => {
      const reserved = await usages.reserve(input());
      expect(await usages.reconcileStale(new Date())).toMatchObject({ checked: 0 });
      expect(await usages.reconcileStale(new Date(Date.now() + 31 * 60_000))).toMatchObject({ checked: 1, refunded: 1 });
      expect(await usage(reserved.id)).toMatchObject({ status: "FAILED", failureCode: "STALE" });
    });

    it("runs in the BullMQ worker on its own schedule", async () => {
      const reserved = await usages.reserve(input());
      process.env.AI_USAGE_RECONCILE_EVERY_MS = "300";
      process.env.AI_USAGE_STALE_MS = "0";
      const worker: INestApplicationContext = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      try {
        await waitFor(async () => (await usage(reserved.id)).status === "FAILED", 10_000);
        expect((await rows(reserved.id)).map((r) => r.type)).toEqual(["DEBIT", "REFUND"]);
      } finally {
        await worker.close();
        delete process.env.AI_USAGE_RECONCILE_EVERY_MS;
        delete process.env.AI_USAGE_STALE_MS;
      }
    }, 20_000);

    it("can be run now by a platform operator only", async () => {
      await as(app, owner.id).post("/admin/jobs/ai-usage-reconcile?minAgeMs=0").expect(403);
      const res = await as(app, operator.id).post("/admin/jobs/ai-usage-reconcile?minAgeMs=0").expect(201);
      expect(res.body).toEqual({ checked: 0, refunded: 0, errors: 0 });
    });
  });

  it("keeps the invariant for every usage: DEBIT + ADJUST + REFUND = −credits, and the ledger sums to the balance", async () => {
    const all = await prisma.aiUsage.findMany({ where: { workspaceId } });
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const u of all) {
      const sum = (await rows(u.id)).reduce((s, r) => s + r.amount, 0);
      expect({ id: u.id, net: sum + u.credits }).toEqual({ id: u.id, net: 0 });
      expect(["SUCCEEDED", "FAILED"]).toContain(u.status);
    }
    const ledger = await prisma.creditLedger.aggregate({ where: { accountId }, _sum: { amount: true } });
    expect(Number(ledger._sum.amount)).toBe(await balance());
  });

  describe("GET /workspaces/:id/ai-usages", () => {
    it("lists newest first for ADMIN+, with cursor pages and filters", async () => {
      const first = await as(app, owner.id).get(`/workspaces/${workspaceId}/ai-usages?limit=2`).expect(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBe(first.body.items[1].id);
      expect(first.body.items[0]).not.toHaveProperty("workspaceId");
      expect(first.body.items[0]).toMatchObject({ user: { id: owner.id }, debitLedgerId: expect.any(String) });
      expect(new Date(first.body.items[0].createdAt) >= new Date(first.body.items[1].createdAt)).toBe(true);

      const second = await as(app, owner.id).get(`/workspaces/${workspaceId}/ai-usages?limit=2&cursor=${first.body.nextCursor}`).expect(200);
      const firstIds = first.body.items.map((i: { id: string }) => i.id);
      expect(second.body.items.some((i: { id: string }) => firstIds.includes(i.id))).toBe(false);

      const failed = await as(app, owner.id).get(`/workspaces/${workspaceId}/ai-usages?status=FAILED&limit=100`).expect(200);
      expect(failed.body.items.length).toBeGreaterThan(0);
      expect(failed.body.items.every((i: { status: string; refundLedgerId: string | null }) => i.status === "FAILED" && i.refundLedgerId)).toBe(true);

      await as(app, owner.id).get(`/workspaces/${workspaceId}/ai-usages?status=DONE`).expect(400);
    });

    it("is 403 for a MEMBER and 404 outside the workspace", async () => {
      await as(app, member.id).get(`/workspaces/${workspaceId}/ai-usages`).expect(403);
      await as(app, outsider.id).get(`/workspaces/${workspaceId}/ai-usages`).expect(404);
    });
  });
});
