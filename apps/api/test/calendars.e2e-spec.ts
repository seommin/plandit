import type { INestApplication } from "@nestjs/common";

import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("캘린더 권한: 멤버지만 역할 부족은 403, 비멤버는 404 (e2e)", () => {
  let app: INestApplication;
  let owner: { id: string; email: string };
  let editor: { id: string; email: string };
  let viewer: { id: string; email: string };
  let outsider: { id: string; email: string };
  let calendarId: string;

  const eventBody = (visibility: "CALENDAR" | "PRIVATE") => ({
    calendarId,
    title: "주간 팀 회의",
    startsAt: "2026-10-01T01:00:00.000Z",
    endsAt: "2026-10-01T02:00:00.000Z",
    visibility,
  });

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    [owner, editor, viewer, outsider] = await Promise.all(
      ["cal-owner", "cal-editor", "cal-viewer", "cal-outsider"].map((name) => registerUser(app, name)),
    );
    calendarId = (await as(app, owner.id).post("/calendars").send({ name: "개발팀 캘린더", type: "SHARED" }).expect(201)).body.calendar.id;
    await as(app, owner.id).post(`/calendars/${calendarId}/invites`).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await as(app, owner.id).post(`/calendars/${calendarId}/invites`).send({ email: viewer.email, role: "VIEWER" }).expect(201);
  });

  afterAll(() => closeTestApp(app));

  it("updating a calendar: VIEWER 403, outsider 404", async () => {
    const forbidden = await as(app, viewer.id).patch(`/calendars/${calendarId}`).send({ name: "바꿈" }).expect(403);
    expect(forbidden.body.code).toBe("FORBIDDEN");
    const notFound = await as(app, outsider.id).patch(`/calendars/${calendarId}`).send({ name: "바꿈" }).expect(404);
    expect(notFound.body.code).toBe("NOT_FOUND");
    await as(app, viewer.id).delete(`/calendars/${calendarId}`).expect(403);
    await as(app, outsider.id).delete(`/calendars/${calendarId}`).expect(404);
  });

  it("managing members and invites: EDITOR 403, outsider 404", async () => {
    const { body } = await as(app, owner.id).get(`/calendars/${calendarId}/members`).expect(200);
    const viewerMemberId = body.members.find((m: { user: { id: string } }) => m.user.id === viewer.id).id;

    await as(app, editor.id).patch(`/calendars/${calendarId}/members/${viewerMemberId}`).send({ role: "EDITOR" }).expect(403);
    await as(app, outsider.id).patch(`/calendars/${calendarId}/members/${viewerMemberId}`).send({ role: "EDITOR" }).expect(404);
    await as(app, editor.id).delete(`/calendars/${calendarId}/members/${viewerMemberId}`).expect(403);
    await as(app, editor.id).post(`/calendars/${calendarId}/invites`).send({ email: outsider.email }).expect(403);
    await as(app, outsider.id).post(`/calendars/${calendarId}/invites`).send({ email: outsider.email }).expect(404);

    const after = await as(app, owner.id).get(`/calendars/${calendarId}/members`).expect(200);
    expect(after.body.members.find((m: { user: { id: string } }) => m.user.id === viewer.id).role).toBe("VIEWER");
    expect(after.body.members).toHaveLength(3);
  });

  it("events: a VIEWER who can see the event gets 403; an outsider or someone else's PRIVATE event stays 404", async () => {
    const shared = (await as(app, editor.id).post("/events").send(eventBody("CALENDAR")).expect(201)).body.event;
    const hidden = (await as(app, editor.id).post("/events").send(eventBody("PRIVATE")).expect(201)).body.event;

    await as(app, viewer.id).post("/events").send(eventBody("CALENDAR")).expect(403);
    await as(app, outsider.id).post("/events").send(eventBody("CALENDAR")).expect(404);
    await as(app, viewer.id).patch(`/events/${shared.id}`).send({ title: "바꿈" }).expect(403);
    await as(app, viewer.id).delete(`/events/${shared.id}`).expect(403);
    await as(app, viewer.id).patch(`/events/${hidden.id}`).send({ title: "바꿈" }).expect(404);
    await as(app, outsider.id).patch(`/events/${shared.id}`).send({ title: "바꿈" }).expect(404);
    await as(app, owner.id).patch(`/events/${shared.id}`).send({ title: "바꿈" }).expect(200);
  });

  it("GET /calendar/state without a range shows this month", async () => {
    const startsAt = new Date();
    const created = (
      await as(app, owner.id)
        .post("/events")
        .send({ ...eventBody("CALENDAR"), startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() })
        .expect(201)
    ).body.event;

    const { body } = await as(app, owner.id).get("/calendar/state").expect(200);
    expect(body.events.map((e: { id: string }) => e.id)).toContain(created.id);
  });
});
