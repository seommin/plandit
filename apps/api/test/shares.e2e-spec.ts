import type { INestApplication } from "@nestjs/common";

import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("공개 일정 링크 (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
  });

  afterAll(() => closeTestApp(app));

  it("hides what the owner chose to hide, whoever calls the API", async () => {
    const owner = await registerUser(app, "share-owner");
    const stranger = await registerUser(app, "share-stranger");

    const { body: created } = await as(app, owner.id)
      .post("/events")
      .send({ title: "주간 팀 회의", description: "연봉 협상 메모", location: "3층 회의실", startsAt: "2026-10-01T01:00:00.000Z", endsAt: "2026-10-01T02:00:00.000Z" })
      .expect(201);
    const { body: shared } = await as(app, owner.id)
      .post(`/events/${created.event.id}/shares`)
      .send({ channel: "LINK", includeDescription: false, includeLocation: true })
      .expect(201);

    // Any signed-in user can reach this through the web proxy; the hidden memo must not be in the response at all.
    const { body } = await as(app, stranger.id).get(`/shares/${shared.share.slug}`).expect(200);
    expect(body.share.event).toEqual({
      title: "주간 팀 회의",
      startsAt: "2026-10-01T01:00:00.000Z",
      endsAt: "2026-10-01T02:00:00.000Z",
      allDay: false,
      description: null,
      location: "3층 회의실",
      calendar: { name: expect.any(String), timezone: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain("연봉 협상 메모");
    expect(body.share).not.toHaveProperty("id");
    expect(body.share).not.toHaveProperty("createdById");
  });

  it("revoked or unknown links are 404", async () => {
    await as(app, "nobody").get("/shares/does-not-exist").expect(404);
  });
});
