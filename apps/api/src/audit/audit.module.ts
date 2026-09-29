import { Controller, Get, Global, Module, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";

import { ErrorCode } from "../common/api-error";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ApiErrors } from "../common/swagger";
import { ZodPipe } from "../common/zod";
import { CurrentMember, Roles } from "../workspace/roles";
import { AuditService } from "./audit.service";

const auditQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  action: z.string().regex(/^[a-z_.]{1,64}$/).optional(),
});

@ApiTags("감사 로그")
@Controller("workspaces/:workspaceId/audit-logs")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles("ADMIN")
  @ApiOperation({
    summary: "감사 로그 (ADMIN+)",
    description:
      "기본 최신순, `cursor`는 로그 id(숫자 문자열). 변경과 같은 트랜잭션에서 쓰므로 로그가 있으면 변경도 반영된 것이다. 웹훅·작업이 한 일은 `actor: null`. `traceId`로 요청 로그와 이어진다. action: workspace.created · workspace.renamed · workspace.member_added · workspace.member_role_changed · workspace.member_removed · credit.adjusted · payment.approved · payment.failed · payment.expired · api_key.created · api_key.revoked",
  })
  @ApiPageQuery()
  @ApiQuery({ name: "action", required: false, description: '정확한 action, 또는 "."으로 끝나는 접두어(예: "payment.")' })
  @ApiOkResponse({
    example: {
      items: [
        {
          id: "4",
          workspaceId: "cmum8usb8000cekyjfuv77ipr",
          action: "workspace.member_role_changed",
          targetType: "workspace_member",
          targetId: "cmum8usb9000eekyjocxa71zc",
          payload: { userId: "cmum8us8q0001ekyj7no7tyc6", from: "MEMBER", to: "ADMIN" },
          traceId: "0d85ad5d-c5b6-4cf3-ba9f-b27e7906d209",
          ip: "127.0.0.1",
          userAgent: "node",
          createdAt: "2026-09-29T06:05:11.402Z",
          actor: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모", email: "demo@plandit.dev" },
        },
        {
          id: "3",
          workspaceId: "cmum8usb8000cekyjfuv77ipr",
          action: "payment.approved",
          targetType: "payment",
          targetId: "cmum9fdk10004qwyjsm3am8d5",
          payload: { amount: 10000, source: "webhook", credits: 1000, tradeId: "P260929-000002", ledgerId: "4" },
          traceId: "8ebe61f1-02a6-4a68-bd3d-5dd4f3f0d4cc",
          ip: "127.0.0.1",
          userAgent: "node",
          createdAt: "2026-09-29T05:53:30.754Z",
          actor: null,
        },
      ],
      nextCursor: "3",
    },
  })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  list(
    @CurrentMember() member: WorkspaceMember,
    @Query(new ZodPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ) {
    return this.audit.list(member.workspaceId, query, query.action);
  }
}

/** Global: every domain module records audit rows. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
