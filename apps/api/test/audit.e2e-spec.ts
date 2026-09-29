import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("PLANDIT-8 audit log (e2e)", () => {
  let app: INestApplication;
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let teamId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    [owner, member] = await Promise.all(["owner", "member"].map((name) => registerUser(app, name)));

    // Headers as the web proxy sends them: trace id, end-user IP and user agent.
    const created = await as(app, owner.id)
      .post("/workspaces")
      .set("x-trace-id", "trace-audit-1")
      .set("x-forwarded-for", "203.0.113.7, 10.0.0.1")
      .set("x-client-user-agent", "Mozilla/5.0 (iPhone)")
      .send({ name: "감사팀" })
      .expect(201);
    teamId = created.body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${teamId}/members`).send({ email: member.email }).expect(201);
    await as(app, owner.id).patch(`/workspaces/${teamId}`).send({ name: "감사팀2" }).expect(200);
  });

  afterAll(() => closeTestApp(app));

  it("records who, from which request, IP and device", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: teamId, action: "workspace.created" } });
    expect(row).toMatchObject({
      actorId: owner.id,
      traceId: "trace-audit-1",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (iPhone)",
      payload: { name: "감사팀" },
    });
  });

  it("ADMIN+ lists newest first with actor details; MEMBER gets 403", async () => {
    const response = await as(app, owner.id).get(`/workspaces/${teamId}/audit-logs`).expect(200);
    expect(response.body.items.map((r: { action: string }) => r.action)).toEqual([
      "workspace.renamed",
      "workspace.member_added",
      "workspace.created",
    ]);
    expect(response.body.items[0]).toMatchObject({ actor: { id: owner.id, email: owner.email }, payload: { from: "감사팀", to: "감사팀2" } });
    await as(app, member.id).get(`/workspaces/${teamId}/audit-logs`).expect(403);
  });

  it("filters by exact action or prefix, and paginates", async () => {
    const exact = await as(app, owner.id).get(`/workspaces/${teamId}/audit-logs?action=workspace.member_added`).expect(200);
    expect(exact.body.items).toHaveLength(1);
    const prefix = await as(app, owner.id).get(`/workspaces/${teamId}/audit-logs?action=workspace.&limit=2`).expect(200);
    expect(prefix.body.items).toHaveLength(2);
    const next = await as(app, owner.id)
      .get(`/workspaces/${teamId}/audit-logs?action=workspace.&limit=2&cursor=${prefix.body.nextCursor}`)
      .expect(200);
    expect(next.body.items.map((r: { action: string }) => r.action)).toEqual(["workspace.created"]);
    expect(next.body.nextCursor).toBeNull();
    await as(app, owner.id).get(`/workspaces/${teamId}/audit-logs?action=DROP TABLE`).expect(400);
  });

  it("is append-only at the database level", async () => {
    await expect(prisma.$executeRaw`UPDATE "AuditLog" SET "action" = 'x'`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog"`).rejects.toThrow(/append-only/);
  });
});
