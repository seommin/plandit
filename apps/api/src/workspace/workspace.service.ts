import { Injectable } from "@nestjs/common";

import { prisma, type WorkspaceMember, type WorkspaceRole } from "@plandit/database/prisma";
import { roleCovers } from "@plandit/shared/workspaces";

import { AuditService } from "../audit/audit.service";
import { ApiError, ErrorCode } from "../common/api-error";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";

const memberUser = { select: { id: true, name: true, email: true, image: true } } as const;

@Injectable()
export class WorkspaceService {
  constructor(private readonly audit: AuditService) {}

  async listMine(userId: string, page: PageQuery) {
    const rows = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      ...pageArgs(page),
    });
    const { items, nextCursor } = toPage(rows, page.limit, (row) => row.id);

    return {
      items: items.map(({ role, workspace }) => ({
        id: workspace.id,
        name: workspace.name,
        type: workspace.type,
        role,
        createdAt: workspace.createdAt,
      })),
      nextCursor,
    };
  }

  create(userId: string, name: string) {
    return prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name,
          type: "TEAM",
          members: { create: { userId, role: "OWNER" } },
          creditAccount: { create: {} },
        },
      });
      await this.audit.record(
        { action: "workspace.created", workspaceId: workspace.id, actorId: userId, targetType: "workspace", targetId: workspace.id, payload: { name } },
        tx,
      );
      return workspace;
    });
  }

  async get(member: WorkspaceMember) {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: member.workspaceId },
      include: { _count: { select: { members: true, calendars: true } } },
    });

    return {
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      role: member.role,
      memberCount: workspace._count.members,
      calendarCount: workspace._count.calendars,
      createdAt: workspace.createdAt,
    };
  }

  rename(actor: WorkspaceMember, name: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId } });
      const workspace = await tx.workspace.update({ where: { id: actor.workspaceId }, data: { name } });
      await this.audit.record(
        { ...this.auditBase(actor, "workspace", workspace.id), action: "workspace.renamed", payload: { from: before.name, to: name } },
        tx,
      );
      return workspace;
    });
  }

  async listMembers(workspaceId: string, page: PageQuery) {
    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: memberUser },
      ...pageArgs(page),
    });
    return toPage(rows, page.limit, (row) => row.id);
  }

  async addMember(actor: WorkspaceMember, email: string, role: WorkspaceRole) {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId } });
    if (workspace.type === "PERSONAL") {
      throw new ApiError(ErrorCode.PERSONAL_WORKSPACE, "Personal workspaces cannot have other members.");
    }
    this.assertCanGrant(actor, role);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
    if (!user) throw new ApiError(ErrorCode.USER_NOT_FOUND, "No user is registered with this email.");

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: user.id } },
    });
    if (existing) throw new ApiError(ErrorCode.ALREADY_MEMBER, "This user is already a member.");

    return prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.create({
        data: { workspaceId: actor.workspaceId, userId: user.id, role },
        include: { user: memberUser },
      });
      await this.audit.record(
        { ...this.auditBase(actor, "workspace_member", member.id), action: "workspace.member_added", payload: { userId: user.id, email: member.user.email, role } },
        tx,
      );
      return member;
    });
  }

  async changeRole(actor: WorkspaceMember, memberId: string, role: WorkspaceRole) {
    const target = await this.findManageableTarget(actor, memberId);
    this.assertCanGrant(actor, role);

    return prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.update({ where: { id: target.id }, data: { role }, include: { user: memberUser } });
      await this.audit.record(
        { ...this.auditBase(actor, "workspace_member", target.id), action: "workspace.member_role_changed", payload: { userId: target.userId, from: target.role, to: role } },
        tx,
      );
      return member;
    });
  }

  async removeMember(actor: WorkspaceMember, memberId: string) {
    const target = await this.findManageableTarget(actor, memberId);
    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.delete({ where: { id: target.id } });
      await this.audit.record(
        { ...this.auditBase(actor, "workspace_member", target.id), action: "workspace.member_removed", payload: { userId: target.userId, role: target.role } },
        tx,
      );
    });
  }

  private auditBase(actor: WorkspaceMember, targetType: string, targetId: string) {
    return { workspaceId: actor.workspaceId, actorId: actor.userId, targetType, targetId };
  }

  /** Target must be in the same workspace, not the actor, and not above the actor's role. */
  private async findManageableTarget(actor: WorkspaceMember, memberId: string) {
    const target = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: actor.workspaceId },
    });
    if (!target) throw new ApiError(ErrorCode.NOT_FOUND, "Member not found.");
    if (target.userId === actor.userId) {
      throw new ApiError(ErrorCode.FORBIDDEN, "You cannot change your own membership.");
    }
    if (!roleCovers(actor.role, target.role)) {
      throw new ApiError(ErrorCode.FORBIDDEN, "You cannot manage a member with a higher role.");
    }
    return target;
  }

  private assertCanGrant(actor: WorkspaceMember, role: WorkspaceRole) {
    if (!roleCovers(actor.role, role)) {
      throw new ApiError(ErrorCode.FORBIDDEN, `You cannot grant a role above your own (${actor.role}).`);
    }
  }
}
