import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { ensurePersonalWorkspace } from "../src/workspace/personal-workspace";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

describe("PLANDIT-2 workspaces & roles (e2e)", () => {
  let app: INestApplication;
  let owner: { id: string; email: string };
  let admin: { id: string; email: string };
  let member: { id: string; email: string };
  let outsider: { id: string; email: string };
  let teamId: string;
  const memberIdOf = async (userId: string) =>
    (await prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: teamId, userId } },
    })).id;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    [owner, admin, member, outsider] = await Promise.all(
      ["owner", "admin", "member", "outsider"].map((name) => registerUser(app, name)),
    );

    const created = await as(app, owner.id).post("/workspaces").send({ name: "마케팅팀" }).expect(201);
    teamId = created.body.workspace.id;
    await as(app, owner.id).post(`/workspaces/${teamId}/members`).send({ email: admin.email, role: "ADMIN" }).expect(201);
    await as(app, owner.id).post(`/workspaces/${teamId}/members`).send({ email: member.email }).expect(201);
  });

  afterAll(() => closeTestApp(app));

  describe("signup", () => {
    it("creates a personal workspace with OWNER membership, credit account and default calendar", async () => {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { personalOwnerId: outsider.id },
        include: { members: true, creditAccount: true, calendars: true },
      });
      expect(workspace.type).toBe("PERSONAL");
      expect(workspace.members).toEqual([expect.objectContaining({ userId: outsider.id, role: "OWNER" })]);
      expect(workspace.creditAccount?.balance).toBe(0n);
      expect(workspace.calendars).toHaveLength(1);
    });

    it("ensurePersonalWorkspace is safe under concurrent calls (OAuth users are created outside /auth/register)", async () => {
      const user = await prisma.user.create({ data: { email: "oauth@test.plandit.dev" } });
      await Promise.all(Array.from({ length: 5 }, () => ensurePersonalWorkspace(user.id)));
      expect(await prisma.workspace.count({ where: { personalOwnerId: user.id } })).toBe(1);
      expect(await prisma.workspaceMember.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe("role gates", () => {
    it("MEMBER cannot change roles → 403", async () => {
      const response = await as(app, member.id)
        .patch(`/workspaces/${teamId}/members/${await memberIdOf(admin.id)}`)
        .send({ role: "MEMBER" })
        .expect(403);
      expect(response.body.code).toBe("FORBIDDEN");
    });

    it("ADMIN cannot grant OWNER → 403 (invite or role change)", async () => {
      await as(app, admin.id)
        .patch(`/workspaces/${teamId}/members/${await memberIdOf(member.id)}`)
        .send({ role: "OWNER" })
        .expect(403);
      await as(app, admin.id)
        .post(`/workspaces/${teamId}/members`)
        .send({ email: outsider.email, role: "OWNER" })
        .expect(403);
    });

    it("ADMIN cannot manage the OWNER, and nobody can change their own role → 403", async () => {
      await as(app, admin.id)
        .patch(`/workspaces/${teamId}/members/${await memberIdOf(owner.id)}`)
        .send({ role: "MEMBER" })
        .expect(403);
      await as(app, owner.id)
        .patch(`/workspaces/${teamId}/members/${await memberIdOf(owner.id)}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });

    it("ADMIN can promote and demote within their own level", async () => {
      const target = await memberIdOf(member.id);
      await as(app, admin.id).patch(`/workspaces/${teamId}/members/${target}`).send({ role: "ADMIN" }).expect(200);
      const back = await as(app, owner.id)
        .patch(`/workspaces/${teamId}/members/${target}`)
        .send({ role: "MEMBER" })
        .expect(200);
      expect(back.body.member.role).toBe("MEMBER");
    });

    it("non-members get 404 with the same body as a non-existent workspace", async () => {
      const hidden = await as(app, outsider.id).get(`/workspaces/${teamId}`).expect(404);
      const missing = await as(app, outsider.id).get("/workspaces/does-not-exist").expect(404);
      expect({ ...hidden.body, traceId: undefined }).toEqual({ ...missing.body, traceId: undefined });
    });
  });

  describe("membership rules", () => {
    it("personal workspaces cannot get extra members → 409", async () => {
      const personal = await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: owner.id } });
      const response = await as(app, owner.id)
        .post(`/workspaces/${personal.id}/members`)
        .send({ email: outsider.email })
        .expect(409);
      expect(response.body.code).toBe("PERSONAL_WORKSPACE");
    });

    it("unknown email → 404 USER_NOT_FOUND, duplicate → 409 ALREADY_MEMBER", async () => {
      const unknown = await as(app, owner.id)
        .post(`/workspaces/${teamId}/members`)
        .send({ email: "nobody@test.plandit.dev" })
        .expect(404);
      expect(unknown.body.code).toBe("USER_NOT_FOUND");
      const duplicate = await as(app, owner.id)
        .post(`/workspaces/${teamId}/members`)
        .send({ email: member.email })
        .expect(409);
      expect(duplicate.body.code).toBe("ALREADY_MEMBER");
    });

    it("lists members with cursor pagination", async () => {
      const first = await as(app, member.id).get(`/workspaces/${teamId}/members?limit=2`).expect(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();
      const second = await as(app, member.id)
        .get(`/workspaces/${teamId}/members?limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
    });

    it("lists my workspaces with my role", async () => {
      const response = await as(app, member.id).get("/workspaces").expect(200);
      expect(response.body.items.map((w: { type: string; role: string }) => [w.type, w.role])).toEqual([
        ["PERSONAL", "OWNER"],
        ["TEAM", "MEMBER"],
      ]);
    });
  });

  describe("calendars belong to workspaces", () => {
    it("members can create calendars in the team workspace; outsiders get 404", async () => {
      const created = await as(app, member.id)
        .post("/calendars")
        .send({ name: "팀 일정", type: "SHARED", workspaceId: teamId })
        .expect(201);
      expect(created.body.calendar.workspaceId).toBe(teamId);

      await as(app, outsider.id)
        .post("/calendars")
        .send({ name: "침입", type: "SHARED", workspaceId: teamId })
        .expect(404);
    });

    it("without workspaceId a calendar goes to the caller's personal workspace", async () => {
      const created = await as(app, outsider.id).post("/calendars").send({ name: "개인 2" }).expect(201);
      const personal = await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: outsider.id } });
      expect(created.body.calendar.workspaceId).toBe(personal.id);
    });
  });

  it("removing a member: ADMIN can remove a MEMBER, then that user loses access (404)", async () => {
    await as(app, admin.id).delete(`/workspaces/${teamId}/members/${await memberIdOf(member.id)}`).expect(204);
    await as(app, member.id).get(`/workspaces/${teamId}`).expect(404);
  });
});
