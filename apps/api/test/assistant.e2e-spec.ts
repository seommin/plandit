import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { prisma } from "@plandit/database/prisma";

import { LLM_CLIENT, type LlmRequest } from "../src/ai/llm-client";
import type { MockLlmAdapter, MockReply } from "../src/ai/mock-llm.adapter";
import { AssistantService } from "../src/assistant/assistant.service";
import { toLocalIso } from "../src/common/zoned-time";
import { LedgerService } from "../src/credit/ledger.service";
import { WorkerModule } from "../src/worker/worker.module";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase, waitFor } from "./helpers";

type User = { id: string; email: string; name: string };
type Item = { type: string; name?: string; status?: string; id: string; text?: string; preview?: Record<string, unknown>; count?: number; error?: string };

/** A local date in Seoul `n` days from now, and an instant on it */
const dayAhead = (n: number) => toLocalIso(new Date(Date.now() + n * 86_400_000), "Asia/Seoul").slice(0, 10);
const at = (date: string, time: string) => `${date}T${time}:00+09:00`;
/** POST /events takes UTC (Z) times */
const utc = (date: string, time: string) => new Date(at(date, time)).toISOString();

describe("PLANDIT-21 AI schedule assistant (e2e)", () => {
  let app: INestApplication;
  let llm: MockLlmAdapter;
  let assistant: AssistantService;
  let ledger: LedgerService;
  let owner: User, member: User, outsider: User;
  let workspaceId: string;
  let teamCalendarId: string;
  let accountId: string;
  const tomorrow = dayAhead(1);

  const base = () => `/workspaces/${workspaceId}/assistant/threads`;
  const newThread = async (user: User = owner) => (await as(app, user.id).post(base()).expect(201)).body.id as string;
  const send = (user: User, threadId: string, text = "내일 팀 회의 잡아줘") => as(app, user.id).post(`${base()}/${threadId}/messages`).send({ text });
  const view = async (threadId: string, user: User = owner) => (await as(app, user.id).get(`${base()}/${threadId}`).expect(200)).body;
  const decide = (user: User, threadId: string, toolCallId: string, decision: "approve" | "reject") =>
    as(app, user.id).post(`${base()}/${threadId}/tool-calls/${toolCallId}/${decision}`);
  const waitingCall = async (threadId: string) => ((await view(threadId)).items as Item[]).find((i) => i.status === "WAITING_APPROVAL")!;
  const balance = async () => Number((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance);
  const meetingInput = (over: Record<string, unknown> = {}) => ({
    calendarId: teamCalendarId,
    title: "팀 회의",
    startsAt: at(tomorrow, "16:00"),
    endsAt: at(tomorrow, "17:00"),
    ...over,
  });
  const propose = (over: Record<string, unknown> = {}): MockReply => ({ text: "이때 잡을까요?", toolCalls: [{ name: "create_event", input: meetingInput(over) }] });
  const events = (title = "팀 회의") => prisma.event.count({ where: { title, calendarId: teamCalendarId } });
  /** What the model was sent, call by call */
  const recordRequests = () => {
    const seen: LlmRequest[] = [];
    const original = llm.complete.bind(llm);
    llm.complete = (request) => (seen.push(structuredClone(request)), original(request));
    return { seen, restore: () => (llm.complete = original) };
  };
  const drain = async () => {
    const left = await balance();
    if (left) await ledger.append({ accountId, type: "DEBIT", amount: -left, refType: "MANUAL", refId: "drain", idempotencyKey: `MANUAL:drain-${Date.now()}` });
  };
  const refill = (amount: number) =>
    ledger.append({ accountId, type: "ADJUST", amount, refType: "MANUAL", refId: "refill", idempotencyKey: `MANUAL:refill-${Date.now()}` });

  beforeAll(async () => {
    app = await createTestApp();
    llm = app.get(LLM_CLIENT);
    assistant = app.get(AssistantService);
    ledger = app.get(LedgerService);
    await resetDatabase();
    [owner, member, outsider] = await Promise.all(["owner", "member", "outsider"].map((n) => registerUser(app, n)));

    workspaceId = (await as(app, owner.id).post("/workspaces").send({ name: "비서팀" }).expect(201)).body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: member.email }).expect(201);
    teamCalendarId = (await as(app, owner.id).post("/calendars").send({ name: "팀 캘린더", type: "SHARED", workspaceId }).expect(201)).body.calendar.id;
    await as(app, owner.id).post(`/calendars/${teamCalendarId}/invites`).send({ email: member.email, role: "EDITOR" }).expect(201);

    accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
    await ledger.append({ accountId, type: "CHARGE", amount: 10_000, refType: "PAYMENT", refId: "seed", idempotencyKey: "PAYMENT:seed:CHARGE" });
  });

  beforeEach(() => llm.reset());

  afterAll(() => closeTestApp(app));

  it("reads with tools over several steps, waits for approval, creates the event once approved, then answers", async () => {
    const start = await balance();
    llm.enqueue(
      { text: "확인해 볼게요.", toolCalls: [{ name: "list_calendars", input: {} }, { name: "list_members", input: {} }] },
      { toolCalls: [{ name: "find_free_slots", input: { fromDate: tomorrow, toDate: tomorrow, durationMinutes: 60, includeWeekends: true } }] },
      propose({ attendeeUserIds: [member.id] }),
      { text: "일정을 넣었어요." },
    );
    const { seen, restore } = recordRequests();
    try {
      const threadId = await newThread();
      const sent = await send(owner, threadId).expect(202);
      expect(sent.body).toMatchObject({ status: "RUNNING", title: "내일 팀 회의 잡아줘", items: [{ type: "user", text: "내일 팀 회의 잡아줘" }] });
      expect(await balance()).toBeLessThan(start); // the first call is reserved with the message

      // A worker retry running alongside changes nothing: each reserved call reaches the model once
      expect((await Promise.all([assistant.run(threadId), assistant.run(threadId)])).sort()).toEqual(["SKIPPED", "WAITING_APPROVAL"]);
      const waiting = await view(threadId);
      expect(waiting.status).toBe("WAITING_APPROVAL");
      expect(waiting.items.map((i: Item) => [i.type, i.name ?? null, i.status ?? null])).toEqual([
        ["user", null, null],
        ["assistant", null, null],
        ["tool", "list_calendars", "DONE"],
        ["tool", "list_members", "DONE"],
        ["tool", "find_free_slots", "DONE"],
        ["assistant", null, null],
        ["tool", "create_event", "WAITING_APPROVAL"],
      ]);
      const card = waiting.items[6] as Item;
      expect(card.preview).toEqual({
        calendar: "팀 캘린더",
        title: "팀 회의",
        start: at(tomorrow, "16:00"),
        end: at(tomorrow, "17:00"),
        location: null,
        attendees: ["member"],
      });
      expect(await events()).toBe(0); // nothing changes before the person says yes
      expect(llm.calls).toBe(3);

      const approved = await decide(owner, threadId, card.id, "approve").expect(200);
      expect(approved.body.status).toBe("RUNNING");
      const created = await prisma.event.findFirstOrThrow({ where: { title: "팀 회의", calendarId: teamCalendarId }, include: { attendees: true } });
      expect(created).toMatchObject({ createdById: owner.id, visibility: "CALENDAR", startsAt: new Date(at(tomorrow, "16:00")) });
      expect(created.attendees.map((a) => a.userId)).toEqual([member.id]);

      expect(await assistant.run(threadId)).toBe("ANSWERED");
      const done = await view(threadId);
      expect(done).toMatchObject({ status: "IDLE", stopCode: null });
      expect(done.items[done.items.length - 1]).toMatchObject({ type: "assistant", text: "일정을 넣었어요." });
      expect(done.items[6]).toMatchObject({ status: "DONE", eventId: created.id });

      // The model saw: both read results in one turn, its earlier replies unchanged, and the created event
      expect(seen).toHaveLength(4);
      expect(seen[1].messages[0].content).toMatch(/^\[지금\] \d{4}-\d{2}-\d{2}T.*\+09:00 \(.\), 시간대 Asia\/Seoul\n\n내일 팀 회의 잡아줘$/);
      expect(seen[1].messages[1]).toEqual(seen[3].messages[1]);
      const reads = seen[1].messages[2];
      expect(reads.role === "user" && reads.toolResults?.map((r) => JSON.parse(r.content))).toEqual([
        { calendars: [expect.objectContaining({ id: teamCalendarId, writable: true })] },
        { members: [{ userId: owner.id, name: "owner", isMe: true }, { userId: member.id, name: "member", isMe: false }] },
      ]);
      const result = seen[3].messages[seen[3].messages.length - 1];
      expect(result.role === "user" && JSON.parse(result.toolResults![0].content)).toMatchObject({ eventId: created.id });
      expect(seen.every((r) => r.system === seen[0].system && JSON.stringify(r.tools) === JSON.stringify(seen[0].tools))).toBe(true);

      // Four model calls, each reserved and settled on its own
      const usages = await prisma.aiUsage.findMany({ where: { assistantMessage: { threadId } } });
      expect(usages.map((u) => u.status)).toEqual(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);
      expect(done.credits).toBe(usages.reduce((s, u) => s + u.credits, 0));
      expect(await balance()).toBe(start - done.credits);
    } finally {
      restore();
    }
  });

  it("only uses what the person could see: another member's private event is neither listed nor blocking", async () => {
    await as(app, owner.id).post("/events").send({ calendarId: teamCalendarId, title: "팀 점심", startsAt: utc(tomorrow, "12:00"), endsAt: utc(tomorrow, "13:00") }).expect(201);
    await as(app, member.id).post("/events").send({ title: "병원 예약", startsAt: utc(tomorrow, "14:00"), endsAt: utc(tomorrow, "15:00") }).expect(201);
    llm.enqueue(
      {
        toolCalls: [
          { name: "list_events", input: { from: at(tomorrow, "00:00"), to: at(tomorrow, "23:59") } },
          { name: "find_free_slots", input: { fromDate: tomorrow, toDate: tomorrow, durationMinutes: 60, dayStart: "11:00", dayEnd: "18:00", includeWeekends: true } },
        ],
      },
      { text: "11시와 13시 이후가 비어 있어요." },
    );
    const threadId = await newThread();
    await send(owner, threadId, "내일 일정 알려줘").expect(202);
    expect(await assistant.run(threadId)).toBe("ANSWERED");

    const calls = await prisma.assistantToolCall.findMany({ where: { threadId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const listed = calls.find((c) => c.name === "list_events")!.output as { events: Array<{ title: string }> };
    expect(listed.events.map((e) => e.title)).toEqual(["팀 점심", "팀 회의"]);
    const free = calls.find((c) => c.name === "find_free_slots")!.output as { freeRanges: Array<{ start: string; end: string }>; basis: string };
    expect(free.freeRanges).toEqual([
      { start: at(tomorrow, "11:00"), end: at(tomorrow, "12:00") },
      { start: at(tomorrow, "13:00"), end: at(tomorrow, "16:00") }, // 14:00 병원 예약 is someone else's private event
      { start: at(tomorrow, "17:00"), end: at(tomorrow, "18:00") }, // after 팀 회의 (16:00) from the first test
    ]);
    expect(free.basis).toContain("볼 수 있는 일정만");
  });

  it("does nothing when the person declines, and tells the model so", async () => {
    llm.enqueue(propose({ title: "거절할 회의" }), { text: "다른 시간을 원하세요?" });
    const threadId = await newThread();
    await send(owner, threadId).expect(202);
    expect(await assistant.run(threadId)).toBe("WAITING_APPROVAL");
    const card = await waitingCall(threadId);

    expect((await decide(owner, threadId, card.id, "reject").expect(200)).body.status).toBe("RUNNING");
    await decide(owner, threadId, card.id, "reject").expect(200); // a repeated click
    await decide(owner, threadId, card.id, "approve").expect(409); // the opposite, afterwards
    expect(await assistant.run(threadId)).toBe("ANSWERED");
    expect(await events("거절할 회의")).toBe(0);

    const results = await prisma.assistantMessage.findFirstOrThrow({ where: { threadId, kind: "TOOL_RESULTS" } });
    expect(results.content).toMatchObject({ toolResults: [{ isError: true, content: JSON.stringify({ error: "사용자가 거절했어요." }) }] });
  });

  it("creates one event however many times, or how concurrently, approve is pressed", async () => {
    llm.enqueue(propose({ title: "한 번만" }), { text: "넣었어요." });
    const threadId = await newThread();
    await send(owner, threadId).expect(202);
    await assistant.run(threadId);
    const card = await waitingCall(threadId);

    const results = await Promise.all([1, 2, 3].map(() => decide(owner, threadId, card.id, "approve")));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    await decide(owner, threadId, card.id, "approve").expect(200);
    await decide(owner, threadId, card.id, "reject").expect(409);
    expect(await events("한 번만")).toBe(1);
    expect(await assistant.run(threadId)).toBe("ANSWERED");
  });

  it("checks permissions again on approval: a role lost while waiting means no event, and the model is told why", async () => {
    llm.enqueue(propose({ title: "권한 빠진 회의" }), { text: "권한이 없어 만들지 못했어요." });
    const threadId = await newThread(member);
    await send(member, threadId).expect(202);
    expect(await assistant.run(threadId)).toBe("WAITING_APPROVAL");
    const card = ((await view(threadId, member)).items as Item[]).find((i) => i.status === "WAITING_APPROVAL")!;

    await prisma.calendarMember.update({ where: { calendarId_userId: { calendarId: teamCalendarId, userId: member.id } }, data: { role: "VIEWER" } });
    try {
      const res = await decide(member, threadId, card.id, "approve").expect(200);
      expect(res.body.items.find((i: Item) => i.id === card.id)).toMatchObject({ status: "ERROR", error: "The user cannot add events to this calendar." });
      expect(await events("권한 빠진 회의")).toBe(0);
      expect(await assistant.run(threadId)).toBe("ANSWERED");
    } finally {
      await prisma.calendarMember.update({ where: { calendarId_userId: { calendarId: teamCalendarId, userId: member.id } }, data: { role: "EDITOR" } });
    }
  });

  it("returns a bad or unknown tool call to the model as an error, without asking anyone", async () => {
    llm.enqueue(
      {
        toolCalls: [
          { name: "create_event", input: meetingInput({ endsAt: at(tomorrow, "15:00") }) }, // ends before it starts
          { name: "delete_everything", input: {} },
          { name: "create_event", input: meetingInput({ attendeeUserIds: [outsider.id] }) }, // not on the calendar
        ],
      },
      { text: "다시 확인해 주세요." },
    );
    const threadId = await newThread();
    await send(owner, threadId).expect(202);
    expect(await assistant.run(threadId)).toBe("ANSWERED");
    const calls = await prisma.assistantToolCall.findMany({ where: { threadId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(calls.map((c) => [c.status, (c.output as { error: string }).error.split(":")[0]])).toEqual([
      ["ERROR", "Invalid input"],
      ["ERROR", "Unknown tool"],
      ["ERROR", "Attendees must be other members of this calendar"],
    ]);
  });

  it("stops at the step limit, and the person can carry on with a new message", async () => {
    process.env.ASSISTANT_MAX_STEPS = "2";
    try {
      llm.enqueue(...[1, 2, 3].map(() => ({ toolCalls: [{ name: "list_calendars", input: {} }] })));
      const threadId = await newThread();
      await send(owner, threadId).expect(202);
      expect(await assistant.run(threadId)).toBe("STEP_LIMIT");
      expect(await view(threadId)).toMatchObject({ status: "IDLE", stopCode: "STEP_LIMIT" });
      expect(llm.calls).toBe(2);

      llm.reset();
      llm.enqueue({ text: "계속할게요." });
      await send(owner, threadId, "계속해").expect(202);
      expect(await assistant.run(threadId)).toBe("ANSWERED");
      expect(await view(threadId)).toMatchObject({ status: "IDLE", stopCode: null });
    } finally {
      delete process.env.ASSISTANT_MAX_STEPS;
    }
  });

  it("refuses a message it cannot pay for, and stops a turn whose next step cannot be paid for", async () => {
    const threadId = await newThread();
    await drain();
    const usagesBefore = await prisma.aiUsage.count();
    expect((await send(owner, threadId).expect(409)).body.code).toBe("INSUFFICIENT_CREDITS");
    expect(await prisma.assistantMessage.count({ where: { threadId } })).toBe(0);
    expect(await prisma.aiUsage.count()).toBe(usagesBefore);

    await refill(1_000);
    llm.enqueue({ toolCalls: [{ name: "list_calendars", input: {} }] });
    await send(owner, threadId).expect(202);
    await drain(); // spent elsewhere meanwhile: settling gives back less than the next, longer step reserves
    expect(await assistant.run(threadId)).toBe("INSUFFICIENT_CREDITS");
    expect(await view(threadId)).toMatchObject({ status: "IDLE", stopCode: "INSUFFICIENT_CREDITS" });
    expect(llm.calls).toBe(1);
    await refill(10_000);
  });

  it("refunds only the call that failed and ends the turn; the next message goes on from there", async () => {
    llm.enqueue({ toolCalls: [{ name: "list_calendars", input: {} }] }, { error: "LLM_OVERLOADED" });
    const threadId = await newThread();
    await send(owner, threadId).expect(202);
    expect(await assistant.run(threadId)).toBe("FAILED");
    expect(await view(threadId)).toMatchObject({ status: "IDLE", stopCode: "LLM_OVERLOADED" });

    const usages = await prisma.aiUsage.findMany({ where: { userId: owner.id, feature: "SCHEDULE_ASSISTANT" }, orderBy: { createdAt: "desc" }, take: 2 });
    expect(usages.map((u) => [u.status, u.failureCode])).toEqual([
      ["FAILED", "LLM_OVERLOADED"],
      ["SUCCEEDED", null],
    ]);
    const refund = await prisma.creditLedger.findFirstOrThrow({ where: { refType: "AI_USAGE", refId: usages[0].id, type: "REFUND" } });
    expect(Number(refund.amount)).toBe(usages[0].estimatedCredits);

    llm.enqueue({ text: "이어서 할게요." });
    await send(owner, threadId, "다시 해줘").expect(202);
    expect(await assistant.run(threadId)).toBe("ANSWERED");
  });

  it("refuses a message while working (409) and declines a waiting change when the person writes something else", async () => {
    llm.enqueue(propose({ title: "넘어간 회의" }), { text: "알겠어요, 다른 걸 할게요." });
    const threadId = await newThread();
    await send(owner, threadId).expect(202);
    expect((await send(owner, threadId, "또 보냄").expect(409)).body.code).toBe("CONFLICT");
    await assistant.run(threadId);
    const card = await waitingCall(threadId);

    await send(owner, threadId, "그거 말고 다른 거").expect(202);
    expect(await prisma.assistantToolCall.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ status: "REJECTED" });
    await decide(owner, threadId, card.id, "approve").expect(409);
    expect(await assistant.run(threadId)).toBe("ANSWERED");
    expect(await events("넘어간 회의")).toBe(0);
    const kinds = await prisma.assistantMessage.findMany({ where: { threadId }, orderBy: { seq: "asc" }, select: { kind: true } });
    expect(kinds.map((k) => k.kind)).toEqual(["USER", "ASSISTANT", "TOOL_RESULTS", "USER", "ASSISTANT"]);
  });

  it("shows a conversation only to the person who started it", async () => {
    const threadId = await newThread(owner);
    await as(app, member.id).get(`${base()}/${threadId}`).expect(404);
    await send(member, threadId).expect(404);
    await as(app, outsider.id).get(`${base()}/${threadId}`).expect(404);
    await as(app, outsider.id).post(base()).expect(404);

    const mine = (await as(app, member.id).get(base()).expect(200)).body.items as Array<{ id: string }>;
    expect(mine.map((t) => t.id)).not.toContain(threadId);
    const page = (await as(app, owner.id).get(`${base()}?limit=2`).expect(200)).body;
    expect(page.items).toHaveLength(2);
    expect(page.items[0].id).toBe(threadId); // newest first
    expect(page.nextCursor).toBe(page.items[1].id);
  });

  it("is driven by the real BullMQ worker on its own (the mock model's meeting script)", async () => {
    const worker: INestApplicationContext = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    try {
      const threadId = await newThread();
      await send(owner, threadId, "회의 잡아줘").expect(202);
      const card = await waitFor(async () => ((await view(threadId)).items as Item[]).find((i) => i.status === "WAITING_APPROVAL"), 10_000);
      expect(card).toMatchObject({ name: "create_event", preview: { calendar: "팀 캘린더", title: "회의" } });

      await decide(owner, threadId, card.id, "approve").expect(200);
      const done = await waitFor(async () => {
        const v = await view(threadId);
        return v.status === "IDLE" && v;
      }, 10_000);
      expect(done.items[done.items.length - 1].text).toContain("일정을 넣었어요");
      expect(await events("회의")).toBe(1);
    } finally {
      await worker.close();
    }
  }, 30_000);

  it("refunds the reserved call at once when the person left the workspace before the worker got to it", async () => {
    const threadId = await newThread(member);
    await send(member, threadId).expect(202);
    const { pendingUsageId } = await prisma.assistantThread.findUniqueOrThrow({ where: { id: threadId } });
    const membership = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: member.id } } });
    await as(app, owner.id).delete(`/workspaces/${workspaceId}/members/${membership.id}`).expect(204);

    expect(await assistant.run(threadId)).toBe("NOT_A_MEMBER");
    expect(llm.calls).toBe(0);
    expect(await prisma.assistantThread.findUniqueOrThrow({ where: { id: threadId } })).toMatchObject({ status: "IDLE", stopCode: "NOT_A_MEMBER", pendingUsageId: null });
    expect(await prisma.aiUsage.findUniqueOrThrow({ where: { id: pendingUsageId! } })).toMatchObject({ status: "FAILED", failureCode: "NOT_A_MEMBER", credits: 0 });
    await as(app, member.id).get(`${base()}/${threadId}`).expect(404);
  });

  it("keeps the invariant for every usage: DEBIT + ADJUST + REFUND = −credits, and the ledger sums to the balance", async () => {
    const all = await prisma.aiUsage.findMany({ where: { workspaceId } });
    expect(all.length).toBeGreaterThanOrEqual(15);
    for (const u of all) {
      const rows = await prisma.creditLedger.findMany({ where: { refType: "AI_USAGE", refId: u.id } });
      expect({ id: u.id, net: rows.reduce((s, r) => s + Number(r.amount), 0) + u.credits }).toEqual({ id: u.id, net: 0 });
      expect(["SUCCEEDED", "FAILED"]).toContain(u.status);
    }
    const sum = await prisma.creditLedger.aggregate({ where: { accountId }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(await balance());
    expect(await prisma.assistantThread.count({ where: { pendingUsageId: { not: null } } })).toBe(0);
  });
});
