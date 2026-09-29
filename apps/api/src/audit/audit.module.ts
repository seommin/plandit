import { Controller, Get, Global, Module, Query } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";

import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ZodPipe } from "../common/zod";
import { CurrentMember, Roles } from "../workspace/roles";
import { AuditService } from "./audit.service";

const auditQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  action: z.string().regex(/^[a-z_.]{1,64}$/).optional(),
});

@ApiTags("audit")
@Controller("workspaces/:workspaceId/audit-logs")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles("ADMIN")
  @ApiPageQuery()
  @ApiQuery({ name: "action", required: false, description: 'exact action, or a prefix ending in "." (e.g. "payment.")' })
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
