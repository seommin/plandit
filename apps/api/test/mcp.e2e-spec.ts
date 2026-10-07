import type { AddressInfo } from "net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { toLocalIso } from "../src/common/zoned-time";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

type User = { id: string; email: string; name: string };
type Text = { type: string; text: string };

const tomorrow = toLocalIso(new Date(Date.now() + 86_400_000), "Asia/Seoul").slice(0, 10);
const at = (time: string) => `${tomorrow}T${time}:00+09:00`;
const utc = (time: string) => new Date(at(time)).toISOString();

describe("PLANDIT-23 MCP server (e2e)", () => {
  let app: INestApplication;
  let url: URL;
  let owner: User, member: User;
  let teamId: string;
  let teamCalendarId: string;
  const clients: Client[] = [];

  const issue = async (scopes: string[], user: User = owner) =>
    (await as(app, user.id).post(`/workspaces/${teamId}/api-keys`).send({ name: "MCP", scopes }).expect(201)).body as { apiKey: { id: string }; token: string };
  /** A real MCP client over Streamable HTTP, as Claude Code would connect */
  const connect = async (token: string) => {
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    clients.push(client);
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: Boolean(result.isError), text: (result.content as Text[])[0].text, data: result.structuredContent as Record<string, unknown> };
  };

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    await app.listen(0, "127.0.0.1");
    url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/v1/mcp`);
    [owner, member] = await Promise.all(["owner", "member"].map((n) => registerUser(app, n)));

    teamId = (await as(app, owner.id).post("/workspaces").send({ name: "MCP팀" }).expect(201)).body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${teamId}/members`).send({ email: member.email }).expect(201);
    teamCalendarId = (await as(app, owner.id).post("/calendars").send({ name: "팀 캘린더", type: "SHARED", workspaceId: teamId }).expect(201)).body.calendar.id;
    await as(app, owner.id).post(`/calendars/${teamCalendarId}/invites`).send({ email: member.email, role: "EDITOR" }).expect(201);

    // One event in the team workspace, one in the owner's personal workspace (outside any team key)
    await as(app, owner.id).post("/events").send({ calendarId: teamCalendarId, title: "팀 점심", startsAt: utc("12:00"), endsAt: utc("13:00") }).expect(201);
    await as(app, owner.id).post("/events").send({ title: "개인 약속", startsAt: utc("15:00"), endsAt: utc("16:00") }).expect(201);
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await closeTestApp(app);
  });

  it("lists only the tools the key's scopes allow, with read-only hints", async () => {
    const full = await connect((await issue(["events:read", "events:write"])).token);
    expect(full.getServerVersion()).toMatchObject({ name: "plandit" });
    const { tools } = await full.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_calendars", "list_members", "list_events", "find_free_slots", "create_event"]);
    expect(tools.find((t) => t.name === "list_events")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((t) => t.name === "create_event")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tools.find((t) => t.name === "find_free_slots")!.inputSchema.required).toEqual(["fromDate", "toDate", "durationMinutes"]);

    const reader = await connect((await issue(["events:read"])).token);
    expect((await reader.listTools()).tools.map((t) => t.name)).not.toContain("create_event");
    const creditsOnly = await connect((await issue(["credits:read"])).token);
    expect((await creditsOnly.listTools()).tools).toEqual([]);
  });

  it("sees only the key's workspace: a personal event is neither listed nor blocking", async () => {
    const client = await connect((await issue(["events:read"])).token);
    const listed = await call(client, "list_events", { from: at("00:00"), to: at("23:59") });
    expect(listed.isError).toBe(false);
    expect((listed.data.events as Array<{ title: string }>).map((e) => e.title)).toEqual(["팀 점심"]);
    expect(JSON.parse(listed.text)).toEqual(listed.data);

    const free = await call(client, "find_free_slots", { fromDate: tomorrow, toDate: tomorrow, durationMinutes: 60, includeWeekends: true });
    expect(free.data.freeRanges).toEqual([
      { start: at("09:00"), end: at("12:00") },
      { start: at("13:00"), end: at("18:00") }, // 15:00 개인 약속 is in the personal workspace
    ]);
    expect((await call(client, "list_calendars")).data.calendars).toEqual([expect.objectContaining({ id: teamCalendarId, name: "팀 캘린더", writable: true })]);
  });

  it("creates an event at once with events:write, and refuses without it", async () => {
    const event = { calendarId: teamCalendarId, title: "MCP 회의", startsAt: at("16:00"), endsAt: at("17:00"), attendeeUserIds: [member.id] };

    const reader = await connect((await issue(["events:read"])).token);
    const refused = await call(reader, "create_event", event);
    expect(refused).toMatchObject({ isError: true, text: "This API key needs the events:write scope for create_event." });
    expect(await prisma.event.count({ where: { title: "MCP 회의" } })).toBe(0);

    const writer = await connect((await issue(["events:read", "events:write"])).token);
    const created = await call(writer, "create_event", event);
    expect(created.isError).toBe(false);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: created.data.eventId as string }, include: { attendees: true } });
    expect(row).toMatchObject({ calendarId: teamCalendarId, createdById: owner.id, visibility: "CALENDAR", startsAt: new Date(at("16:00")) });
    expect(row.attendees.map((a) => a.userId)).toEqual([member.id]);
    // The member sees it in the app like any other event
    const seen = (await as(app, member.id).get(`/events?from=${utc("00:00")}&to=${utc("23:59")}`).expect(200)).body.events as Array<{ id: string }>;
    expect(seen.map((e) => e.id)).toContain(row.id);
  });

  it("returns bad input, unknown tools and permission problems as tool errors", async () => {
    const client = await connect((await issue(["events:read", "events:write"], member)).token);
    expect(await call(client, "create_event", { calendarId: teamCalendarId, title: "x", startsAt: at("10:00"), endsAt: at("09:00") })).toMatchObject({
      isError: true,
      text: expect.stringContaining("Invalid input"),
    });
    expect(await call(client, "delete_everything")).toMatchObject({ isError: true, text: "Unknown tool: delete_everything" });

    await prisma.calendarMember.update({ where: { calendarId_userId: { calendarId: teamCalendarId, userId: member.id } }, data: { role: "VIEWER" } });
    try {
      expect(await call(client, "create_event", { calendarId: teamCalendarId, title: "권한 없음", startsAt: at("10:00"), endsAt: at("11:00") })).toMatchObject({
        isError: true,
        text: "The user cannot add events to this calendar.",
      });
    } finally {
      await prisma.calendarMember.update({ where: { calendarId_userId: { calendarId: teamCalendarId, userId: member.id } }, data: { role: "EDITOR" } });
    }
    expect(await prisma.event.count({ where: { title: { in: ["x", "권한 없음"] } } })).toBe(0);
  });

  it("refuses a missing, revoked or orphaned key with 401, and has no server stream (405)", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } };
    const post = (token?: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(init),
      });
    const missing = await post();
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const revoked = await issue(["events:read"]);
    expect((await post(revoked.token)).status).toBe(200);
    await as(app, owner.id).delete(`/workspaces/${teamId}/api-keys/${revoked.apiKey.id}`).expect(200);
    expect((await post(revoked.token)).status).toBe(401);

    // The member's key stops working the moment they leave the workspace
    const orphan = await issue(["events:read"], member);
    const membership = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: teamId, userId: member.id } } });
    await as(app, owner.id).delete(`/workspaces/${teamId}/members/${membership.id}`).expect(204);
    expect((await post(orphan.token)).status).toBe(401);
    await expect(connect(orphan.token)).rejects.toThrow();

    const stream = await fetch(url, { headers: { authorization: `Bearer ${(await issue(["events:read"])).token}`, accept: "text/event-stream" } });
    expect(stream.status).toBe(405);
    expect(stream.headers.get("allow")).toBe("POST");
  });
});
