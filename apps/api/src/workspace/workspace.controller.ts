import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import {
  workspaceCreateSchema,
  workspaceMemberAddSchema,
  workspaceMemberUpdateSchema,
  workspaceUpdateSchema,
} from "@plandit/shared/workspaces";

import { ErrorCode } from "../common/api-error";
import { ApiPageQuery, type PageQuery, pageQuerySchema } from "../common/pagination";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { getUserId, type RequestWithUser } from "../request-user";
import { ensurePersonalWorkspace } from "./personal-workspace";
import { CurrentMember, Roles } from "./roles";
import { WorkspaceService } from "./workspace.service";

const WORKSPACE_EXAMPLE = {
  id: "cmum8usb8000cekyjfuv77ipr",
  name: "Plandit 데모팀",
  type: "TEAM",
  personalOwnerId: null,
  createdAt: "2026-09-29T05:36:49.364Z",
  updatedAt: "2026-09-29T05:36:49.364Z",
};

const MEMBER_EXAMPLE = {
  id: "cmum8usb9000eekyjocxa71zc",
  workspaceId: "cmum8usb8000cekyjfuv77ipr",
  userId: "cmum8us8q0001ekyj7no7tyc6",
  role: "MEMBER",
  createdAt: "2026-09-29T05:36:49.364Z",
  user: { id: "cmum8us8q0001ekyj7no7tyc6", name: "이팀원", email: "teammate@plandit.dev", image: null },
};

@ApiTags("워크스페이스")
@Controller("workspaces")
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get()
  @ApiOperation({
    summary: "내 워크스페이스 목록",
    description: "내가 속한 워크스페이스와 거기서의 내 역할. 개인 워크스페이스가 아직 없으면(OAuth로 가입한 사용자) 이때 만든다.",
  })
  @ApiPageQuery()
  @ApiOkResponse({
    example: {
      items: [
        { id: "cmum8usab0002ekyjdlidg1xw", name: "개인 워크스페이스", type: "PERSONAL", role: "OWNER", createdAt: "2026-09-29T05:36:49.329Z" },
        { id: "cmum8usb8000cekyjfuv77ipr", name: "Plandit 데모팀", type: "TEAM", role: "OWNER", createdAt: "2026-09-29T05:36:49.364Z" },
      ],
      nextCursor: null,
    },
  })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  async list(@Req() request: RequestWithUser, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    const userId = getUserId(request);
    await ensurePersonalWorkspace(userId);
    return this.workspaces.listMine(userId, page);
  }

  @Post()
  @ApiOperation({
    summary: "팀 워크스페이스 만들기",
    description: "만든 사람이 OWNER가 되고, 잔액 0인 크레딧 계정이 함께 생긴다. 감사 로그 `workspace.created`를 같은 트랜잭션에 남긴다.",
  })
  @ApiZodBody(workspaceCreateSchema, { name: "Plandit 데모팀" })
  @ApiCreatedResponse({ example: { workspace: WORKSPACE_EXAMPLE } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  async create(
    @Req() request: RequestWithUser,
    @Body(new ZodPipe(workspaceCreateSchema)) body: z.infer<typeof workspaceCreateSchema>,
  ) {
    return { workspace: await this.workspaces.create(getUserId(request), body.name) };
  }

  @Get(":workspaceId")
  @Roles("MEMBER")
  @ApiOperation({ summary: "워크스페이스 한 곳 (MEMBER+)", description: "내 역할과 멤버·캘린더 수를 함께 준다. 멤버가 아니면 404." })
  @ApiOkResponse({
    example: {
      workspace: {
        id: "cmum8usb8000cekyjfuv77ipr",
        name: "Plandit 데모팀",
        type: "TEAM",
        role: "OWNER",
        memberCount: 2,
        calendarCount: 1,
        createdAt: "2026-09-29T05:36:49.364Z",
      },
    },
  })
  @ApiErrors(ErrorCode.NOT_FOUND)
  async get(@CurrentMember() member: WorkspaceMember) {
    return { workspace: await this.workspaces.get(member) };
  }

  @Patch(":workspaceId")
  @Roles("ADMIN")
  @ApiOperation({ summary: "이름 바꾸기 (ADMIN+)", description: "감사 로그 `workspace.renamed`(이전·새 이름)를 같은 트랜잭션에 남긴다." })
  @ApiZodBody(workspaceUpdateSchema, { name: "Plandit 제품팀" })
  @ApiOkResponse({ example: { workspace: { ...WORKSPACE_EXAMPLE, name: "Plandit 제품팀", updatedAt: "2026-09-29T06:10:02.518Z" } } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  async rename(
    @CurrentMember() member: WorkspaceMember,
    @Body(new ZodPipe(workspaceUpdateSchema)) body: z.infer<typeof workspaceUpdateSchema>,
  ) {
    return { workspace: await this.workspaces.rename(member, body.name) };
  }

  @Get(":workspaceId/members")
  @Roles("MEMBER")
  @ApiOperation({ summary: "멤버 목록 (MEMBER+)" })
  @ApiPageQuery()
  @ApiOkResponse({
    example: {
      items: [
        {
          id: "cmum8usb9000dekyjfjd7k754",
          workspaceId: "cmum8usb8000cekyjfuv77ipr",
          userId: "cmum8us8f0000ekyjnxhqh0h4",
          role: "OWNER",
          createdAt: "2026-09-29T05:36:49.364Z",
          user: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모", email: "demo@plandit.dev", image: null },
        },
        MEMBER_EXAMPLE,
      ],
      nextCursor: null,
    },
  })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.NOT_FOUND)
  listMembers(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    return this.workspaces.listMembers(member.workspaceId, page);
  }

  @Post(":workspaceId/members")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "멤버 추가 (ADMIN+)",
    description:
      "가입한 사용자를 이메일로 바로 추가한다(역할 기본값 MEMBER). 내 역할보다 높은 역할은 줄 수 없다(403). 개인 워크스페이스에는 추가할 수 없다(`PERSONAL_WORKSPACE`). 감사 로그 `workspace.member_added`를 같은 트랜잭션에 남긴다.",
  })
  @ApiZodBody(workspaceMemberAddSchema, { email: "teammate@plandit.dev", role: "MEMBER" })
  @ApiCreatedResponse({ example: { member: MEMBER_EXAMPLE } })
  @ApiErrors(
    ErrorCode.VALIDATION_FAILED,
    ErrorCode.NOT_FOUND,
    ErrorCode.USER_NOT_FOUND,
    ErrorCode.FORBIDDEN,
    ErrorCode.ALREADY_MEMBER,
    ErrorCode.PERSONAL_WORKSPACE,
  )
  async addMember(
    @CurrentMember() actor: WorkspaceMember,
    @Body(new ZodPipe(workspaceMemberAddSchema)) body: z.infer<typeof workspaceMemberAddSchema>,
  ) {
    return { member: await this.workspaces.addMember(actor, body.email, body.role) };
  }

  @Patch(":workspaceId/members/:memberId")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "멤버 역할 바꾸기 (ADMIN+)",
    description:
      "내 멤버십은 바꿀 수 없고, 나보다 높은 역할의 멤버를 바꾸거나 내 역할보다 높은 역할을 줄 수 없다(403). 이 워크스페이스의 멤버가 아니면 404. 감사 로그 `workspace.member_role_changed`를 같은 트랜잭션에 남긴다.",
  })
  @ApiZodBody(workspaceMemberUpdateSchema, { role: "ADMIN" })
  @ApiOkResponse({ example: { member: { ...MEMBER_EXAMPLE, role: "ADMIN" } } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
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
  @ApiOperation({
    summary: "멤버 내보내기 (ADMIN+)",
    description: "나 자신과 나보다 높은 역할의 멤버는 내보낼 수 없다(403). 감사 로그 `workspace.member_removed`를 같은 트랜잭션에 남긴다.",
  })
  @ApiNoContentResponse({ description: "내보냄" })
  @ApiErrors(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  async removeMember(@CurrentMember() actor: WorkspaceMember, @Param("memberId") memberId: string) {
    await this.workspaces.removeMember(actor, memberId);
  }
}
