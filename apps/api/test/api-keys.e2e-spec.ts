import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { prisma } from "@plandit/database/prisma";

import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("PLANDIT-13 API keys + rate limit (e2e)", () => {
  let app: INestApplication;
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let teamId: string;
  let teamCalendarId: string;
  let otherCalendarId: string;

  const v1 = (token?: string) => {
    const server = app.getHttpServer();
    const auth = (t: request.Test) => (token ? t.set("authorization", `Bearer ${token}`) : t);
    return {
      get: (url: string) => auth(request(server).get(`/v1${url}`)),
      post: (url: string) => auth(request(server).post(`/v1${url}`)),
    };
  };
  const createKey = async (userId: string, body: object) =>
    (await as(app, userId).post(`/workspaces/${teamId}/api-keys`).send(body).expect(201)).body as {
      apiKey: { id: string; prefix: string };
      token: string;
    };
  const event = (calendarId: string) => ({
    calendarId,
    title: "API로 만든 일정",
    startsAt: "2026-11-01T01:00:00.000Z",
    endsAt: "2026-11-01T02:00:00.000Z",
  });

  beforeAll(async () => {
    process.env.API_KEY_RATE_LIMIT_PER_MIN = "1000";
    app = await createTestApp();
    await resetDatabase();
    [owner, member] = await Promise.all(["owner", "member"].map((n) => registerUser(app, n)));
    teamId = (await as(app, owner.id).post("/workspaces").send({ name: "연동팀" }).expect(201)).body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${teamId}/members`).send({ email: member.email }).expect(201);
    teamCalendarId = (await as(app, owner.id).post("/calendars").send({ name: "팀 캘린더", type: "SHARED", workspaceId: teamId }).expect(201)).body.calendar.id;
    await prisma.calendarMember.create({ data: { calendarId: teamCalendarId, userId: member.id, role: "EDITOR" } });
    otherCalendarId = (await prisma.calendar.findFirstOrThrow({ where: { workspace: { personalOwnerId: member.id } } })).id;
  });

  afterAll(async () => {
    delete process.env.API_KEY_RATE_LIMIT_PER_MIN;
    await closeTestApp(app);
  });

  it("the token is returned once and only its hash is stored", async () => {
    const { apiKey, token } = await createKey(member.id, { name: "자동화", scopes: ["events:read"] });
    expect(token).toMatch(/^pk_[\w-]{32}$/);
    expect(apiKey.prefix).toBe(token.slice(0, 11));

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(JSON.stringify(stored)).not.toContain(token.slice(11));
    const listed = await as(app, member.id).get(`/workspaces/${teamId}/api-keys`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(token.slice(11));
  });

  it("missing, malformed, unknown, revoked, expired and orphaned keys all get the same 401", async () => {
    const revoked = await createKey(member.id, { name: "폐기", scopes: ["events:read"] });
    await as(app, member.id).delete(`/workspaces/${teamId}/api-keys/${revoked.apiKey.id}`).expect(200);
    const expired = await createKey(member.id, { name: "만료", scopes: ["events:read"], expiresInDays: 1 });
    await prisma.apiKey.update({ where: { id: expired.apiKey.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const responses = await Promise.all([
      v1().get("/events"),
      v1("not-a-key").get("/events"),
      v1("pk_0123456789abcdefghijklmnopqrstuv").get("/events"),
      v1(revoked.token).get("/events"),
      v1(expired.token).get("/events"),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(new Set(responses.map((r) => JSON.stringify({ ...r.body, traceId: undefined }))).size).toBe(1);
  });

  it("scopes: a read key cannot write (403); a write key creates events only inside its workspace (404 outside)", async () => {
    const reader = await createKey(member.id, { name: "읽기", scopes: ["events:read"] });
    await v1(reader.token).post("/events").send(event(teamCalendarId)).expect(403);

    const writer = await createKey(member.id, { name: "쓰기", scopes: ["events:read", "events:write"] });
    const created = await v1(writer.token).post("/events").send(event(teamCalendarId)).expect(201);
    expect(created.body.event.calendarId).toBe(teamCalendarId);
    await v1(writer.token).post("/events").send(event(otherCalendarId)).expect(404); // member's own personal calendar, other workspace

    const listed = await v1(writer.token).get("/events?limit=10").expect(200);
    expect(listed.body.items.map((e: { id: string }) => e.id)).toContain(created.body.event.id);
    await v1(writer.token).get("/credits").expect(403);
  });

  it("a key stops working when its owner leaves the workspace", async () => {
    const { token } = await createKey(member.id, { name: "퇴사자", scopes: ["credits:read"] });
    await v1(token).get("/credits").expect(200);

    const membership = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: teamId, userId: member.id } } });
    await as(app, owner.id).delete(`/workspaces/${teamId}/members/${membership.id}`).expect(204);
    await v1(token).get("/credits").expect(401);
    await as(app, owner.id).post(`/workspaces/${teamId}/members`).send({ email: member.email }).expect(201);
  });

  it("members manage their own keys; ADMIN+ see and revoke everyone's", async () => {
    const mine = await createKey(member.id, { name: "멤버 키", scopes: ["events:read"] });
    const ownerKey = await createKey(owner.id, { name: "오너 키", scopes: ["events:read"] });

    const memberList = await as(app, member.id).get(`/workspaces/${teamId}/api-keys?limit=100`).expect(200);
    expect(memberList.body.items.every((k: { owner: { id: string } }) => k.owner.id === member.id)).toBe(true);
    await as(app, member.id).delete(`/workspaces/${teamId}/api-keys/${ownerKey.apiKey.id}`).expect(404);

    const ownerList = await as(app, owner.id).get(`/workspaces/${teamId}/api-keys?limit=100`).expect(200);
    expect(ownerList.body.items.map((k: { id: string }) => k.id)).toEqual(expect.arrayContaining([mine.apiKey.id, ownerKey.apiKey.id]));
    await as(app, owner.id).delete(`/workspaces/${teamId}/api-keys/${mine.apiKey.id}`).expect(200);
    await v1(mine.token).get("/events").expect(401);
  });

  it("rate limit: 429 with Retry-After once the per-minute budget is spent", async () => {
    process.env.API_KEY_RATE_LIMIT_PER_MIN = "3";
    try {
      const { token } = await createKey(owner.id, { name: "한도", scopes: ["credits:read"] });
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push(await v1(token).get("/credits"));
      expect(statuses.map((r) => r.status)).toEqual([200, 200, 200, 429]);
      expect(statuses[2].headers["x-ratelimit-remaining"]).toBe("0");
      expect(Number(statuses[3].headers["retry-after"])).toBeGreaterThan(0);
      expect(statuses[3].body.code).toBe("RATE_LIMITED");
    } finally {
      process.env.API_KEY_RATE_LIMIT_PER_MIN = "1000";
    }
  });

  it("key creation and revocation are audited", async () => {
    const created = await prisma.auditLog.count({ where: { workspaceId: teamId, action: "api_key.created" } });
    const revoked = await prisma.auditLog.count({ where: { workspaceId: teamId, action: "api_key.revoked" } });
    expect(created).toBe(await prisma.apiKey.count({ where: { workspaceId: teamId } }));
    expect(revoked).toBe(await prisma.apiKey.count({ where: { workspaceId: teamId, revokedAt: { not: null } } }));
  });
});
