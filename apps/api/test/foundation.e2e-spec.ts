import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { TAGS } from "../src/common/swagger";
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

  it("documents every endpoint: summary, a known tag, the shared error schema, and the right auth", async () => {
    const doc = (await request(app.getHttpServer()).get("/docs-json").expect(200)).body;
    const tags = new Set(TAGS.map(([name]) => name));
    const operations = Object.entries(doc.paths as Record<string, Record<string, { summary?: string; tags?: string[]; security?: unknown[]; responses: Record<string, unknown> }>>).flatMap(([path, item]) =>
      Object.entries(item).map(([method, operation]) => ({ name: `${method.toUpperCase()} ${path}`, path, operation })),
    );

    expect(doc.components.schemas.ApiError).toBeDefined();
    expect(operations.filter(({ operation }) => !operation.summary).map(({ name }) => name)).toEqual([]);
    expect(operations.filter(({ operation }) => !operation.tags?.every((tag) => tags.has(tag))).map(({ name }) => name)).toEqual([]);
    // Money paths enter from outside: both webhooks are documented and authenticated by signature, not the internal secret.
    for (const path of ["/webhooks/payments/mock", "/webhooks/relay/mock"]) {
      expect(doc.paths[path].post.security).toEqual([]);
      expect(doc.paths[path].post.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "x-mock-signature", in: "header" })]));
    }
    expect(doc.paths["/v1/events"].get.security).toEqual([{ "api-key": [] }]);
    expect(doc.paths["/v1/mcp"].post.security).toEqual([{ "api-key": [] }]);
    expect(doc.paths["/workspaces/{workspaceId}/payments/charge"].post.responses["401"]).toBeDefined();
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
