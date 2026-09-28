import { Injectable } from "@nestjs/common";

import { prisma, type WorkspaceMember, type WorkspaceRole } from "@plandit/database/prisma";
import { roleCovers } from "@plandit/shared/workspaces";

import { ApiError, ErrorCode } from "../common/api-error";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";

const memberUser = { select: { id: true, name: true, email: true, image: true } } as const;

@Injectable()
export class WorkspaceService {
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
    return prisma.workspace.create({
      data: {
        name,
        type: "TEAM",
        members: { create: { userId, role: "OWNER" } },
        creditAccount: { create: {} },
      },
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

  rename(workspaceId: string, name: string) {
    return prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
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

    return prisma.workspaceMember.create({
      data: { workspaceId: actor.workspaceId, userId: user.id, role },
      include: { user: memberUser },
    });
  }

  async changeRole(actor: WorkspaceMember, memberId: string, role: WorkspaceRole) {
    const target = await this.findManageableTarget(actor, memberId);
    this.assertCanGrant(actor, role);

    return prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role },
      include: { user: memberUser },
    });
  }

  async removeMember(actor: WorkspaceMember, memberId: string) {
    const target = await this.findManageableTarget(actor, memberId);
    await prisma.workspaceMember.delete({ where: { id: target.id } });
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
