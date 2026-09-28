import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { closeTestApp, createTestApp } from "./helpers";

describe("PLANDIT-1 foundation (e2e)", () => {
  let app: INestApplication;
  const secret = process.env.API_INTERNAL_SECRET ?? "";

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => closeTestApp(app));

  it("GET /health checks postgres and redis without the internal secret", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok", db: "ok", redis: "ok" });
    expect(response.headers["x-trace-id"]).toBeTruthy();
  });

  it("serves Swagger UI and the OpenAPI document", async () => {
    await request(app.getHttpServer()).get("/docs").expect(200);
    const doc = await request(app.getHttpServer()).get("/docs-json").expect(200);
    expect(doc.body.paths["/auth/register"].post.requestBody).toBeDefined();
  });

  it("rejects calls without the internal secret in the common error format", async () => {
    const response = await request(app.getHttpServer()).get("/calendar/state").expect(401);
    expect(response.body).toEqual({
      code: "UNAUTHORIZED",
      message: "Invalid internal API secret.",
      traceId: response.headers["x-trace-id"],
    });
  });

  it("returns 400 with per-field details and echoes the caller's X-Trace-Id", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/register")
      .set("x-api-secret", secret)
      .set("x-trace-id", "trace-e2e-1")
      .send({ name: "", email: "not-an-email", password: "short" })
      .expect(400);

    expect(response.headers["x-trace-id"]).toBe("trace-e2e-1");
    expect(response.body).toMatchObject({ code: "VALIDATION_FAILED", traceId: "trace-e2e-1" });
    expect(response.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
      "email",
      "name",
      "password",
    ]);
  });
});
