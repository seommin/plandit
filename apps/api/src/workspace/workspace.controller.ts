import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import {
  workspaceCreateSchema,
  workspaceMemberAddSchema,
  workspaceMemberUpdateSchema,
  workspaceUpdateSchema,
} from "@plandit/shared/workspaces";

import { ApiPageQuery, type PageQuery, pageQuerySchema } from "../common/pagination";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { getUserId, type RequestWithUser } from "../request-user";
import { ensurePersonalWorkspace } from "./personal-workspace";
import { CurrentMember, Roles } from "./roles";
import { WorkspaceService } from "./workspace.service";

@ApiTags("workspaces")
@Controller("workspaces")
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get()
  @ApiPageQuery()
  async list(@Req() request: RequestWithUser, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    const userId = getUserId(request);
    await ensurePersonalWorkspace(userId);
    return this.workspaces.listMine(userId, page);
  }

  @Post()
  @ApiZodBody(workspaceCreateSchema)
  async create(
    @Req() request: RequestWithUser,
    @Body(new ZodPipe(workspaceCreateSchema)) body: z.infer<typeof workspaceCreateSchema>,
  ) {
    return { workspace: await this.workspaces.create(getUserId(request), body.name) };
  }

  @Get(":workspaceId")
  @Roles("MEMBER")
  async get(@CurrentMember() member: WorkspaceMember) {
    return { workspace: await this.workspaces.get(member) };
  }

  @Patch(":workspaceId")
  @Roles("ADMIN")
  @ApiZodBody(workspaceUpdateSchema)
  async rename(
    @CurrentMember() member: WorkspaceMember,
    @Body(new ZodPipe(workspaceUpdateSchema)) body: z.infer<typeof workspaceUpdateSchema>,
  ) {
    return { workspace: await this.workspaces.rename(member.workspaceId, body.name) };
  }

  @Get(":workspaceId/members")
  @Roles("MEMBER")
  @ApiPageQuery()
  listMembers(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    return this.workspaces.listMembers(member.workspaceId, page);
  }

  @Post(":workspaceId/members")
  @Roles("ADMIN")
  @ApiZodBody(workspaceMemberAddSchema)
  async addMember(
    @CurrentMember() actor: WorkspaceMember,
    @Body(new ZodPipe(workspaceMemberAddSchema)) body: z.infer<typeof workspaceMemberAddSchema>,
  ) {
    return { member: await this.workspaces.addMember(actor, body.email, body.role) };
  }

  @Patch(":workspaceId/members/:memberId")
  @Roles("ADMIN")
  @ApiZodBody(workspaceMemberUpdateSchema)
  async changeRole(
    @CurrentMember() actor: WorkspaceMember,
    @Param("memberId") memberId: string,
    @Body(new ZodPipe(workspaceMemberUpdateSchema)) body: z.infer<typeof workspaceMemberUpdateSchema>,
  ) {
    return { member: await this.workspaces.changeRole(actor, memberId, body.role) };
  }

  @Delete(":workspaceId/members/:memberId")
  @Roles("ADMIN")
  @HttpCode(204)
  async removeMember(@CurrentMember() actor: WorkspaceMember, @Param("memberId") memberId: string) {
    await this.workspaces.removeMember(actor, memberId);
  }
}
