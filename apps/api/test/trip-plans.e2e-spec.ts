import { randomUUID } from "crypto";

import type { INestApplication, INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { prisma } from "@plandit/database/prisma";
import type { TripDraft } from "@plandit/shared/trips";

import { AiUsageService } from "../src/ai/ai-usage.service";
import { LLM_CLIENT } from "../src/ai/llm-client";
import type { MockLlmAdapter } from "../src/ai/mock-llm.adapter";
import { LedgerService } from "../src/credit/ledger.service";
import { TripPlanService } from "../src/trip/trip-plan.service";
import { WorkerModule } from "../src/worker/worker.module";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase, waitFor } from "./helpers";

type User = { id: string; email: string };

describe("PLANDIT-26 AI trip plans (e2e)", () => {
  let app: INestApplication;
  let llm: MockLlmAdapter;
  let plans: TripPlanService;
  let owner: User, editor: User, viewer: User, buddy: User, buddy2: User, leaver: User, outsider: User;
  let workspaceId: string;
  let calendarId: string;
  let personalCalendarId: string;
  let otherCalendarId: string;
  let accountId: string;

  const base = () => `/workspaces/${workspaceId}/trip-plans`;
  const form = (over: Record<string, unknown> = {}) => ({
    calendarId,
    destination: "부산",
    startDate: "2026-10-09",
    endDate: "2026-10-11",
    attendeeUserIds: [] as string[],
    pace: "NORMAL",
    interests: ["FOOD"],
    request: "",
    ...over,
  });
  const create = (user: User, body: Record<string, unknown>, key: string = randomUUID()) =>
    as(app, user.id).post(base()).set("idempotency-key", key).send(body);
  const plan = (user: User, id: string) => as(app, user.id).get(`${base()}/${id}`);
  const ready = async (user: User, body: Record<string, unknown>) => {
    const created = await create(user, body).expect(202);
    expect(await plans.generate(created.body.id)).toBe("SUCCEEDED");
    return (await plan(user, created.body.id).expect(200)).body;
  };
  const balance = async () => Number((await prisma.creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance);
  const itemCount = (draft: TripDraft) => draft.days.reduce((n, d) => n + d.items.length, 0);
  const roleOn = async (userId: string) =>
    (await prisma.calendarMember.findUnique({ where: { calendarId_userId: { calendarId, userId } } }))?.role ?? null;
  const memberIdOf = async (userId: string) =>
    (await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId } } })).id;

  beforeAll(async () => {
    app = await createTestApp();
    llm = app.get(LLM_CLIENT);
    plans = app.get(TripPlanService);
    await resetDatabase();
    [owner, editor, viewer, buddy, buddy2, leaver, outsider] = await Promise.all(
      ["owner", "editor", "viewer", "buddy", "buddy2", "leaver", "outsider"].map((n) => registerUser(app, n)),
    );

    workspaceId = (await as(app, owner.id).post("/workspaces").send({ name: "여행팀" }).expect(201)).body.workspace.id;
    for (const user of [editor, viewer, buddy, buddy2, leaver]) {
      await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: user.email }).expect(201);
    }
    calendarId = (await as(app, owner.id).post("/calendars").send({ name: "팀 여행", type: "SHARED", workspaceId }).expect(201)).body.calendar.id;
    await as(app, owner.id).post(`/calendars/${calendarId}/invites`).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await as(app, owner.id).post(`/calendars/${calendarId}/invites`).send({ email: viewer.email, role: "VIEWER" }).expect(201);
    personalCalendarId = (await as(app, owner.id).post("/calendars").send({ name: "혼자", type: "PERSONAL", workspaceId }).expect(201)).body.calendar.id;

    const other = (await as(app, outsider.id).post("/workspaces").send({ name: "남의 팀" }).expect(201)).body.workspace.id;
    otherCalendarId = (await as(app, outsider.id).post("/calendars").send({ name: "남의 캘린더", type: "SHARED", workspaceId: other }).expect(201)).body.calendar.id;

    accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
    await app.get(LedgerService).append({ accountId, type: "CHARGE", amount: 10_000, refType: "PAYMENT", refId: "seed", idempotencyKey: "PAYMENT:seed:CHARGE" });
  });

  beforeEach(() => llm.reset());

  afterAll(() => closeTestApp(app));

  describe("options", () => {
    it("lists who can come and the most a trip can cost", async () => {
      const res = await as(app, owner.id).get(`${base()}/options?calendarId=${calendarId}`).expect(200);
      expect(res.body).toMatchObject({ attendeesAllowed: true, canAddMembers: true, balance: 10_000 });
      const byId = Object.fromEntries(res.body.members.map((m: { id: string }) => [m.id, m]));
      expect(byId[owner.id]).toBeUndefined();
      expect(byId[editor.id]).toMatchObject({ onCalendar: true, selectable: true });
      expect(byId[buddy.id]).toMatchObject({ onCalendar: false, selectable: true });
      const max = res.body.maxCredits as Record<string, number>;
      expect(Object.keys(max)).toHaveLength(7);
      expect(max["7"]).toBeGreaterThan(max["1"]);
    });

    it("marks people off the calendar unselectable for an EDITOR, and refuses a VIEWER or an outsider", async () => {
      const res = await as(app, editor.id).get(`${base()}/options?calendarId=${calendarId}`).expect(200);
      expect(res.body.canAddMembers).toBe(false);
      expect(res.body.members.find((m: { id: string }) => m.id === buddy.id)).toMatchObject({ selectable: false });
      await as(app, viewer.id).get(`${base()}/options?calendarId=${calendarId}`).expect(403);
      await as(app, outsider.id).get(`${base()}/options?calendarId=${calendarId}`).expect(404);
      expect((await as(app, owner.id).get(`${base()}/options?calendarId=${personalCalendarId}`).expect(200)).body).toMatchObject({
        attendeesAllowed: false,
        members: [],
      });
    });
  });

  describe("create → generate", () => {
    it("reserves, drafts in the background, and settles to the actual cost", async () => {
      const start = await balance();
      const created = await create(owner, form()).expect(202);
      expect(created.body).toMatchObject({ status: "GENERATING", draft: null, credits: 0 });
      expect(await balance()).toBe(start - created.body.estimatedCredits);

      await plans.generate(created.body.id);
      const done = (await plan(owner, created.body.id).expect(200)).body;
      expect(done.status).toBe("READY");
      expect(done.draft.days.map((d: { date: string }) => d.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
      expect(done.credits).toBeGreaterThan(0);
      expect(done.credits).toBeLessThan(done.estimatedCredits);
      expect(await balance()).toBe(start - done.credits);
      expect(llm.calls).toBe(1);
    });

    it("sends the model the head count, never who is going", async () => {
      const seen: string[] = [];
      const original = llm.complete.bind(llm);
      llm.complete = (request) => (seen.push(request.messages[0].content), original(request));
      try {
        await ready(owner, form({ attendeeUserIds: [editor.id] }));
      } finally {
        llm.complete = original;
      }
      expect(seen[0]).toContain('"travelers":2');
      expect(seen[0]).not.toContain(editor.id);
      expect(seen[0]).not.toContain(editor.email);
    });

    it("makes one plan and one reservation per Idempotency-Key, even when sent at once", async () => {
      const key = randomUUID();
      const results = await Promise.all([1, 2, 3].map(() => create(owner, form({ destination: "제주" }), key)));
      expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      const debits = await prisma.creditLedger.count({ where: { refType: "AI_USAGE", refId: (await prisma.tripPlan.findUniqueOrThrow({ where: { id: results[0].body.id } })).aiUsageId, type: "DEBIT" } });
      expect(debits).toBe(1);

      await create(owner, form({ destination: "강릉" }), key).expect(409).expect((r) => expect(r.body.code).toBe("IDEMPOTENCY_CONFLICT"));
    });

    it("rejects a missing key and a bad form", async () => {
      await as(app, owner.id).post(base()).send(form()).expect(400);
      await create(owner, form({ endDate: "2026-10-08" })).expect(400);
      await create(owner, form({ endDate: "2026-10-16" })).expect(400); // 8 days
      await create(owner, form({ destination: "" })).expect(400);
    });

    it("is 409 with nothing recorded and no model call when credits run short", async () => {
      const poor = (await as(app, owner.id).post("/workspaces").send({ name: "빈 팀" }).expect(201)).body.workspace.id;
      const cal = (await as(app, owner.id).post("/calendars").send({ name: "빈 캘린더", type: "SHARED", workspaceId: poor }).expect(201)).body.calendar.id;
      const res = await as(app, owner.id).post(`/workspaces/${poor}/trip-plans`).set("idempotency-key", randomUUID()).send(form({ calendarId: cal })).expect(409);
      expect(res.body.code).toBe("INSUFFICIENT_CREDITS");
      expect(await prisma.tripPlan.count({ where: { workspaceId: poor } })).toBe(0);
      expect(await prisma.aiUsage.count({ where: { workspaceId: poor } })).toBe(0);
      expect(llm.calls).toBe(0);
    });

    it.each([
      ["the model is overloaded", { error: "LLM_OVERLOADED" as const }, "LLM_OVERLOADED"],
      ["the model times out", { error: "LLM_TIMEOUT" as const }, "LLM_TIMEOUT"],
      ["the reply is not the schema", { text: '{"days":[]}' }, "INVALID_OUTPUT"],
      [
        "the reply leaves the trip dates",
        { text: JSON.stringify({ timezone: "Asia/Seoul", notes: null, days: [{ date: "2026-12-25", items: [{ title: "x", startTime: "10:00", endTime: "11:00", location: null, description: null, category: "SIGHT" }] }] }) },
        "INVALID_OUTPUT",
      ],
      [
        "an item ends before it starts",
        { text: JSON.stringify({ timezone: "Asia/Seoul", notes: null, days: [{ date: "2026-10-09", items: [{ title: "x", startTime: "11:00", endTime: "10:00", location: null, description: null, category: "SIGHT" }] }] }) },
        "INVALID_OUTPUT",
      ],
      [
        "the time zone is made up",
        { text: JSON.stringify({ timezone: "Mars/Olympus", notes: null, days: [{ date: "2026-10-09", items: [{ title: "x", startTime: "10:00", endTime: "11:00", location: null, description: null, category: "SIGHT" }] }] }) },
        "INVALID_OUTPUT",
      ],
    ])("fails the plan and refunds everything when %s", async (_label, reply, code) => {
      const start = await balance();
      const created = await create(owner, form()).expect(202);
      llm.enqueue(reply);
      expect(await plans.generate(created.body.id)).toBe("FAILED");
      expect((await plan(owner, created.body.id).expect(200)).body).toMatchObject({ status: "FAILED", failureCode: code, credits: 0 });
      expect(await balance()).toBe(start);
      expect(await plans.generate(created.body.id)).toBe("SKIPPED"); // a retried job does nothing
    });

    it("fails a plan stuck in GENERATING when the stale AI usage sweep refunds it", async () => {
      const created = await create(owner, form()).expect(202);
      await app.get(AiUsageService).reconcileStale(new Date(Date.now() + 31 * 60_000));
      expect((await plan(owner, created.body.id).expect(200)).body).toMatchObject({ status: "FAILED", failureCode: "STALE" });
      const { aiUsageId } = await prisma.tripPlan.findUniqueOrThrow({ where: { id: created.body.id } });
      const rows = await prisma.creditLedger.findMany({ where: { refType: "AI_USAGE", refId: aiUsageId }, orderBy: { id: "asc" } });
      expect(rows.map((r) => [r.type, Number(r.amount)])).toEqual([
        ["DEBIT", -created.body.estimatedCredits],
        ["REFUND", created.body.estimatedCredits],
      ]);
    });

    it("is generated by the real BullMQ worker on its own", async () => {
      const created = await create(owner, form({ destination: "경주" })).expect(202);
      const worker: INestApplicationContext = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      try {
        await waitFor(async () => (await prisma.tripPlan.findUniqueOrThrow({ where: { id: created.body.id } })).status === "READY", 10_000);
      } finally {
        await worker.close();
      }
    }, 20_000);
  });

  describe("permissions", () => {
    it("refuses a VIEWER (403), an outsider (404), another workspace's calendar (404) and someone else's plan (404)", async () => {
      await create(viewer, form()).expect(403);
      await create(outsider, form()).expect(404);
      await create(owner, form({ calendarId: otherCalendarId })).expect(404);
      const mine = await create(owner, form()).expect(202);
      await plan(editor, mine.body.id).expect(404);
      await as(app, editor.id).post(`${base()}/${mine.body.id}/apply`).send({ newCalendarMemberIds: [] }).expect(404);
    });

    it("lets only calendar OWNER/ADMIN bring someone who is not on the calendar", async () => {
      const usagesBefore = await prisma.aiUsage.count();
      const res = await create(editor, form({ attendeeUserIds: [buddy2.id] })).expect(403);
      expect(res.body.code).toBe("FORBIDDEN");
      expect(await prisma.aiUsage.count()).toBe(usagesBefore); // refused before anything was reserved
      await create(editor, form({ attendeeUserIds: [viewer.id] })).expect(202); // already on the calendar: fine
    });

    it("accepts only other members of this workspace, on a shared calendar", async () => {
      for (const body of [form({ attendeeUserIds: [outsider.id] }), form({ attendeeUserIds: [owner.id] }), form({ calendarId: personalCalendarId, attendeeUserIds: [editor.id] })]) {
        const res = await create(owner, body).expect(400);
        expect(res.body.code).toBe("ATTENDEE_NOT_ELIGIBLE");
      }
    });
  });

  describe("apply", () => {
    it("adds the events with attendees, and makes a confirmed newcomer a VIEWER while others keep their role", async () => {
      const draft = await ready(owner, form({ attendeeUserIds: [buddy.id, editor.id] }));
      expect(draft.newCalendarMemberIds).toEqual([buddy.id]);
      const n = itemCount(draft.draft);

      const changed = await as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [] }).expect(409);
      expect(changed.body).toMatchObject({ code: "CALENDAR_MEMBERS_CHANGED", details: { newCalendarMemberIds: [buddy.id] } });
      expect(await prisma.event.count({ where: { tripPlanId: draft.id } })).toBe(0);
      expect(await roleOn(buddy.id)).toBeNull();

      const applied = await as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [buddy.id] }).expect(200);
      expect(applied.body).toMatchObject({ status: "APPLIED", eventCount: n, addedCalendarMemberIds: [buddy.id], newCalendarMemberIds: [] });
      expect(await prisma.eventAttendee.count({ where: { event: { tripPlanId: draft.id } } })).toBe(n * 2);
      expect(await roleOn(buddy.id)).toBe("VIEWER");
      expect(await roleOn(editor.id)).toBe("EDITOR");

      const seenByBuddy = await as(app, buddy.id).get(`/events?calendarId=${calendarId}`).expect(200);
      expect(seenByBuddy.body.events.filter((e: { title: string }) => e.title.includes("부산")).length).toBeGreaterThan(0);

      // again: same result, nothing doubled
      await as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [buddy.id] }).expect(200);
      expect(await prisma.event.count({ where: { tripPlanId: draft.id } })).toBe(n);
      expect(await prisma.calendarMember.count({ where: { calendarId, userId: buddy.id } })).toBe(1);

      // undo: only this plan's events go; buddy stays on the calendar
      const undone = await as(app, owner.id).delete(`${base()}/${draft.id}/events`).expect(200);
      expect(undone.body).toEqual({ deleted: n });
      expect(await prisma.event.count({ where: { tripPlanId: draft.id } })).toBe(0);
      expect((await plan(owner, draft.id).expect(200)).body.status).toBe("READY");
      expect(await roleOn(buddy.id)).toBe("VIEWER");
      await as(app, owner.id).delete(`${base()}/${draft.id}/events`).expect(409);
    });

    it("creates the events once when applied twice at the same time", async () => {
      const draft = await ready(owner, form({ destination: "여수" }));
      const results = await Promise.all([1, 2].map(() => as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [] })));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await prisma.event.count({ where: { tripPlanId: draft.id } })).toBe(itemCount(draft.draft));
    });

    it("re-checks attendees at apply time: someone who left the workspace blocks it", async () => {
      const draft = await ready(owner, form({ attendeeUserIds: [leaver.id] }));
      await as(app, owner.id).delete(`/workspaces/${workspaceId}/members/${await memberIdOf(leaver.id)}`).expect(204);
      const res = await as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [] }).expect(400);
      expect(res.body).toMatchObject({ code: "ATTENDEE_NOT_ELIGIBLE", details: { userIds: [leaver.id] } });
      expect(await prisma.event.count({ where: { tripPlanId: draft.id } })).toBe(0);
    });

    it("stores local times of another time zone as real instants and notes them in the description", async () => {
      llm.enqueue({
        text: JSON.stringify({
          timezone: "Europe/Paris",
          notes: null,
          days: [{ date: "2026-10-10", items: [{ title: "루브르", startTime: "10:00", endTime: "12:00", location: "Louvre", description: "오전이 한산해요.", category: "SIGHT" }] }],
        }),
      });
      const draft = await ready(owner, form({ destination: "파리" }));
      await as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [] }).expect(200);
      const [event] = await prisma.event.findMany({ where: { tripPlanId: draft.id } });
      expect(event.startsAt.toISOString()).toBe("2026-10-10T08:00:00.000Z"); // CEST, UTC+2
      expect(event.endsAt.toISOString()).toBe("2026-10-10T10:00:00.000Z");
      expect(event.description).toBe("현지 10:00–12:00 · Europe/Paris\n오전이 한산해요.");
      expect(event.visibility).toBe("CALENDAR");
    });
  });

  describe("edit before applying", () => {
    it("replaces days (sorted), rejects bad edits, and refuses once applied", async () => {
      const draft = await ready(owner, form());
      const [first, ...rest] = draft.draft.days;
      const kept = [...rest, { ...first, items: [...first.items].reverse().slice(0, 2) }];
      const saved = await as(app, owner.id).patch(`${base()}/${draft.id}`).send({ days: kept }).expect(200);
      expect(saved.body.draft.days[0].date).toBe(first.date);
      expect(saved.body.draft.days[0].items.map((i: { startTime: string }) => i.startTime)).toEqual(
        [...first.items].reverse().slice(0, 2).map((i: { startTime: string }) => i.startTime).sort(),
      );

      const outside = [{ ...first, date: "2027-01-01" }];
      expect((await as(app, owner.id).patch(`${base()}/${draft.id}`).send({ days: outside }).expect(400)).body.details[0].path).toBe("days.0.date");
      const backwards = [{ ...first, items: [{ ...first.items[0], startTime: "12:00", endTime: "11:00" }] }];
      await as(app, owner.id).patch(`${base()}/${draft.id}`).send({ days: backwards }).expect(400);
      await as(app, owner.id).patch(`${base()}/${draft.id}`).send({ attendeeUserIds: [outsider.id] }).expect(400);

      await as(app, owner.id).patch(`${base()}/${draft.id}`).send({ attendeeUserIds: [editor.id] }).expect(200);
      await as(app, owner.id).post(`${base()}/${draft.id}/apply`).send({ newCalendarMemberIds: [] }).expect(200);
      await as(app, owner.id).patch(`${base()}/${draft.id}`).send({ days: kept }).expect(409);
    });

    it("lists only my own plans, newest first", async () => {
      const mine = await as(app, owner.id).get(`${base()}?limit=3`).expect(200);
      expect(mine.body.items).toHaveLength(3);
      expect(mine.body.items[0]).toMatchObject({ destination: expect.any(String), startDate: "2026-10-09" });
      const theirs = await as(app, editor.id).get(base()).expect(200);
      expect(theirs.body.items.every((i: { id: string }) => !mine.body.items.some((m: { id: string }) => m.id === i.id))).toBe(true);
    });
  });

  describe("revise by chat (PLANDIT-27)", () => {
    type Revision = { id: string; request: string; status: string; failureCode: string | null; credits: number; estimatedCredits: number; proposedDraft?: TripDraft; baseDraft?: TripDraft };
    const revisions = (id: string) => `${base()}/${id}/revisions`;
    const ask = (user: User, id: string, request = "둘째 날 오후는 쉬게 해줘", key: string = randomUUID()) =>
      as(app, user.id).post(revisions(id)).set("idempotency-key", key).send({ request });
    const last = async (id: string) => {
      const list = (await plan(owner, id).expect(200)).body.revisions as Revision[];
      return list[list.length - 1];
    };
    const secondDay = (draft: TripDraft) => draft.days[1].items.map((i) => i.title);

    it("proposes a rewrite without touching the draft, and applies it only when accepted", async () => {
      const p = await ready(owner, form({ destination: "강릉" }));
      expect(secondDay(p.draft)).toContain("강릉 둘러보기");
      const start = await balance();

      const asked = await ask(owner, p.id).expect(202);
      const pending = (asked.body.revisions as Revision[])[0];
      expect(pending).toMatchObject({ request: "둘째 날 오후는 쉬게 해줘", status: "PENDING" });
      expect(await balance()).toBe(start - pending.estimatedCredits);

      expect(await plans.revise(pending.id)).toBe("SUCCEEDED");
      const proposed = await last(p.id);
      expect(proposed.status).toBe("PROPOSED");
      expect(secondDay(proposed.proposedDraft!)).toEqual(["점심", "숙소에서 쉬기", "저녁"]);
      expect(proposed.baseDraft).toEqual(p.draft);
      expect(secondDay((await plan(owner, p.id).expect(200)).body.draft)).toContain("강릉 둘러보기"); // not yet

      const accepted = await as(app, owner.id).post(`${revisions(p.id)}/${proposed.id}/accept`).expect(200);
      expect(secondDay(accepted.body.draft)).toEqual(["점심", "숙소에서 쉬기", "저녁"]);
      expect(accepted.body.draft.days[0]).toEqual(p.draft.days[0]); // other days untouched
      await as(app, owner.id).post(`${revisions(p.id)}/${proposed.id}/accept`).expect(200); // a repeated click
      await as(app, owner.id).post(`${revisions(p.id)}/${proposed.id}/discard`).expect(409);
      const done = await last(p.id);
      expect(done).toMatchObject({ status: "ACCEPTED" });
      expect(done.proposedDraft).toBeUndefined();
      expect(done.credits).toBeGreaterThan(0);
      expect(await balance()).toBe(start - done.credits);
    });

    it("makes one revision per Idempotency-Key, refuses a second while one is being written, and lets a new one replace an undecided proposal", async () => {
      const p = await ready(owner, form({ destination: "속초" }));
      const key = randomUUID();
      const results = await Promise.all([1, 2, 3].map(() => ask(owner, p.id, "둘째 날 오후는 쉬게 해줘", key)));
      expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
      const [first] = (await plan(owner, p.id).expect(200)).body.revisions as Revision[];
      expect(await prisma.tripPlanRevision.count({ where: { tripPlanId: p.id } })).toBe(1);
      await ask(owner, p.id, "다른 요청", key).expect(409); // same key, other words
      expect((await ask(owner, p.id, "첫째 날 오전은 쉬게").expect(409)).body.code).toBe("CONFLICT"); // still being written

      await plans.revise(first.id);
      await ask(owner, p.id, "첫째 날 오전은 쉬게 해줘").expect(202); // replaces the undecided proposal
      const list = (await plan(owner, p.id).expect(200)).body.revisions as Revision[];
      expect(list.map((r) => r.status)).toEqual(["DISCARDED", "PENDING"]);
      await as(app, owner.id).post(`${revisions(p.id)}/${first.id}/accept`).expect(409);
      await plans.revise(list[1].id);
      await as(app, owner.id).post(`${revisions(p.id)}/${list[1].id}/discard`).expect(200);
      expect((await plan(owner, p.id).expect(200)).body.draft).toEqual(p.draft); // discarded: nothing changed
    });

    it("never overwrites edits made by hand after the request", async () => {
      const p = await ready(owner, form({ destination: "여수" }));
      await ask(owner, p.id).expect(202);
      const pending = await last(p.id);
      const days = p.draft.days.map((d: TripDraft["days"][number], i: number) => (i === 0 ? { ...d, items: d.items.map((it) => ({ ...it, title: `${it.title}(수정)` })) } : d));
      await as(app, owner.id).patch(`${base()}/${p.id}`).send({ days }).expect(200);
      await plans.revise(pending.id);

      const res = await as(app, owner.id).post(`${revisions(p.id)}/${pending.id}/accept`).expect(409);
      expect(res.body.code).toBe("TRIP_DRAFT_CHANGED");
      const kept = (await plan(owner, p.id).expect(200)).body.draft as TripDraft;
      expect(kept.days[0].items[0].title).toContain("(수정)");
      expect(secondDay(kept)).toContain("여수 둘러보기");
    });

    it("refunds a failed rewrite in full and leaves the draft as it was", async () => {
      const p = await ready(owner, form({ destination: "전주" }));
      llm.enqueue({ error: "LLM_OVERLOADED" });
      await ask(owner, p.id).expect(202);
      const failed = await last(p.id);
      expect(await plans.revise(failed.id)).toBe("FAILED");
      expect(await last(p.id)).toMatchObject({ status: "FAILED", failureCode: "LLM_OVERLOADED", credits: 0 });

      // A rewrite that leaves the trip's dates is refused like a bad draft
      llm.enqueue({ text: JSON.stringify({ ...p.draft, days: [{ date: "2027-01-01", items: p.draft.days[0].items }] }) });
      await ask(owner, p.id, "날짜를 바꿔줘").expect(202);
      expect(await plans.revise((await last(p.id)).id)).toBe("FAILED");
      expect(await last(p.id)).toMatchObject({ status: "FAILED", failureCode: "INVALID_OUTPUT" });

      const { aiUsageId } = await prisma.tripPlanRevision.findFirstOrThrow({ where: { id: failed.id } });
      const rows = await prisma.creditLedger.findMany({ where: { refType: "AI_USAGE", refId: aiUsageId }, orderBy: { id: "asc" } });
      expect(rows.map((r) => r.type)).toEqual(["DEBIT", "REFUND"]);
      expect((await plan(owner, p.id).expect(200)).body.draft).toEqual(p.draft);
    });

    it("only on a READY plan of one's own, with a request and a key", async () => {
      const p = await ready(owner, form({ destination: "경주" }));
      await ask(editor, p.id).expect(404);
      await as(app, owner.id).post(revisions(p.id)).send({ request: "쉬게 해줘" }).expect(400); // no key
      await ask(owner, p.id, "   ").expect(400);
      await ask(owner, p.id, "가".repeat(301)).expect(400);

      const generating = await create(owner, form({ destination: "안동" })).expect(202);
      await ask(owner, generating.body.id).expect(409);
      await as(app, owner.id).post(`${base()}/${p.id}/apply`).send({ newCalendarMemberIds: [] }).expect(200);
      await ask(owner, p.id).expect(409);
    });

    it("is rewritten by the real BullMQ worker on its own", async () => {
      const p = await ready(owner, form({ destination: "통영" }));
      await ask(owner, p.id).expect(202);
      const worker: INestApplicationContext = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      try {
        await waitFor(async () => (await last(p.id)).status === "PROPOSED", 10_000);
      } finally {
        await worker.close();
      }
    }, 20_000);
  });

  it("keeps the credit invariant for every trip usage once all settle: DEBIT + ADJUST + REFUND = −credits", async () => {
    await app.get(AiUsageService).reconcileStale(new Date(Date.now() + 31 * 60_000)); // close the plans never generated
    const usages = await prisma.aiUsage.findMany({ where: { feature: "TRIP_PLANNER" } });
    expect(usages.every((u) => u.status === "SUCCEEDED" || u.status === "FAILED")).toBe(true);
    expect(await prisma.tripPlan.count({ where: { status: "GENERATING" } })).toBe(0);
    expect(usages.length).toBeGreaterThan(10);
    for (const usage of usages) {
      const rows = await prisma.creditLedger.findMany({ where: { refType: "AI_USAGE", refId: usage.id } });
      const net = rows.reduce((sum, r) => sum + Number(r.amount), 0) + usage.credits;
      expect({ id: usage.id, net }).toEqual({ id: usage.id, net: 0 });
    }
  });
});
