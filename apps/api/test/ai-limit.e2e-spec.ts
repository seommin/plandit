import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { AiUsageService } from "../src/ai/ai-usage.service";
import { LLM_CLIENT, type LlmRequest } from "../src/ai/llm-client";
import type { MockLlmAdapter } from "../src/ai/mock-llm.adapter";
import { ApiError } from "../src/common/api-error";
import { toLocalIso } from "../src/common/zoned-time";
import { LedgerService } from "../src/credit/ledger.service";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

type User = { id: string; email: string };

describe("PLANDIT-24 monthly AI credit limit (e2e)", () => {
  let app: INestApplication;
  let usages: AiUsageService;
  let llm: MockLlmAdapter;
  let owner: User, admin: User, member: User, outsider: User;
  let workspaceId: string;
  let estimate: number;

  const request: LlmRequest = { system: "한도 시험", messages: [{ role: "user", content: "안녕" }], maxOutputTokens: 1_000 };
  const reserve = () => usages.reserve({ workspaceId, userId: owner.id, feature: "SCHEDULE_ASSISTANT", request });
  const limitPath = () => `/workspaces/${workspaceId}/ai-limit`;
  const setLimit = (user: User, monthlyCreditLimit: number | null) => as(app, user.id).patch(limitPath()).send({ monthlyCreditLimit });
  const status = async () => (await as(app, member.id).get(limitPath()).expect(200)).body;
  const audits = () => prisma.auditLog.findMany({ where: { workspaceId, action: "workspace.ai_limit_changed" }, orderBy: { id: "asc" } });
  const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : String(error));

  beforeAll(async () => {
    app = await createTestApp();
    usages = app.get(AiUsageService);
    llm = app.get(LLM_CLIENT);
    await resetDatabase();
    [owner, admin, member, outsider] = await Promise.all(["owner", "admin", "member", "outsider"].map((n) => registerUser(app, n)));
    workspaceId = (await as(app, owner.id).post("/workspaces").send({ name: "한도팀" }).expect(201)).body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: admin.email, role: "ADMIN" }).expect(201);
    await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: member.email }).expect(201);
    const accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
    await app.get(LedgerService).append({ accountId, type: "CHARGE", amount: 10_000, refType: "PAYMENT", refId: "seed", idempotencyKey: "PAYMENT:seed:CHARGE" });
    estimate = usages.estimate(request);
  });

  beforeEach(() => llm.reset());

  afterAll(() => closeTestApp(app));

  it("has no limit by default, and reports the month on the Seoul clock", async () => {
    const body = await status();
    expect(body).toMatchObject({ monthlyCreditLimit: null, used: 0, remaining: null });
    expect(toLocalIso(new Date(body.periodStart), "Asia/Seoul")).toMatch(/-01T00:00:00\+09:00$/);
    expect(toLocalIso(new Date(body.resetsAt), "Asia/Seoul")).toMatch(/-01T00:00:00\+09:00$/);
    expect(new Date(body.resetsAt).getTime()).toBeGreaterThan(Date.now());
    await as(app, outsider.id).get(limitPath()).expect(404);
  });

  it("lets ADMIN+ change it, audited once per real change", async () => {
    await setLimit(member, 100).expect(403);
    await setLimit(admin, 0).expect(400);
    await setLimit(admin, 1.5).expect(400);
    expect((await setLimit(admin, 100).expect(200)).body).toMatchObject({ monthlyCreditLimit: 100, remaining: 100 });
    await setLimit(admin, 100).expect(200); // the same value again
    await setLimit(owner, null).expect(200);
    expect((await audits()).map((a) => [a.actorId, a.payload])).toEqual([
      [admin.id, { from: null, to: 100 }],
      [owner.id, { from: 100, to: null }],
    ]);
  });

  it("lets exactly as many concurrent reservations through as the limit holds, counting calls in flight", async () => {
    await setLimit(admin, 2 * estimate).expect(200);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => reserve()));
    const reserved = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const refused = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    expect(reserved).toHaveLength(2);
    expect(refused.map(codeOf)).toEqual(["AI_MONTHLY_LIMIT", "AI_MONTHLY_LIMIT", "AI_MONTHLY_LIMIT"]);
    expect((refused[0] as ApiError).details).toMatchObject({ limit: 2 * estimate, used: 2 * estimate, requested: estimate });
    // Refused reservations leave nothing behind
    expect(await prisma.aiUsage.count({ where: { workspaceId } })).toBe(2);
    expect(await prisma.creditLedger.count({ where: { refType: "AI_USAGE", type: "DEBIT" } })).toBe(2);
    expect(await status()).toMatchObject({ used: 2 * estimate, remaining: 0 });

    // A failed call is refunded and stops counting; a settled one counts what it charged
    await usages.fail(reserved[0].id, "LLM_ERROR");
    const outcome = await usages.execute(reserved[1].id, request, { parse: (r) => r.text });
    expect(outcome.status).toBe("SUCCEEDED");
    const charged = outcome.usage.credits;
    expect(charged).toBeLessThan(estimate);
    expect(await status()).toMatchObject({ used: charged, remaining: 2 * estimate - charged });

    const third = await reserve(); // charged + estimate ≤ 2 × estimate
    expect(await status()).toMatchObject({ used: charged + estimate });
    await expect(reserve()).rejects.toMatchObject({ code: "AI_MONTHLY_LIMIT" });
    await usages.fail(third.id, "LLM_ERROR");
  });

  it("does not count last month, and lowering below this month's use blocks until it is raised or removed", async () => {
    const lastMonth = new Date(new Date(( await status()).periodStart).getTime() - 1_000);
    await prisma.aiUsage.create({
      data: { workspaceId, userId: owner.id, feature: "TRIP_PLANNER", provider: "mock", maxOutputTokens: 1, estimatedCredits: 9_999, credits: 9_999, status: "SUCCEEDED", createdAt: lastMonth },
    });
    const used = (await status()).used;
    expect(used).toBeLessThan(9_999);

    await setLimit(admin, Math.max(1, used - 1)).expect(200);
    expect(await status()).toMatchObject({ remaining: 0 });
    await expect(reserve()).rejects.toMatchObject({ code: "AI_MONTHLY_LIMIT" });
    await setLimit(admin, null).expect(200);
    await usages.fail((await reserve()).id, "LLM_ERROR");
  });

  it("refuses an AI feature over HTTP with 409 AI_MONTHLY_LIMIT and nothing stored", async () => {
    await setLimit(admin, 1).expect(200);
    const thread = (await as(app, member.id).post(`/workspaces/${workspaceId}/assistant/threads`).expect(201)).body.id;
    const res = await as(app, member.id).post(`/workspaces/${workspaceId}/assistant/threads/${thread}/messages`).send({ text: "회의 잡아줘" }).expect(409);
    expect(res.body).toMatchObject({ code: "AI_MONTHLY_LIMIT", details: { limit: 1 } });
    expect(await prisma.assistantMessage.count({ where: { threadId: thread } })).toBe(0);
    expect(llm.calls).toBe(0);
    await setLimit(admin, null).expect(200);
  });
});
