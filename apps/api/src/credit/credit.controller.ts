import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { OperatorGuard } from "../common/operator.guard";
import { ApiPageQuery, pageQuerySchema } from "../common/pagination";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { getUserId, type RequestWithUser } from "../request-user";
import { CurrentMember, Roles } from "../workspace/roles";
import { CreditService } from "./credit.service";

const ledgerQuerySchema = pageQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  type: z.enum(["CHARGE", "DEBIT", "REFUND", "ADJUST"]).optional(),
});

const adjustmentSchema = z.object({
  amount: z.number().int().refine((value) => value !== 0, "Amount must not be zero."),
  memo: z.string().trim().min(1).max(200),
});

@ApiTags("credits")
@Controller()
export class CreditController {
  constructor(private readonly credits: CreditService) {}

  @Get("workspaces/:workspaceId/credits")
  @Roles("MEMBER")
  balance(@CurrentMember() member: WorkspaceMember) {
    return this.credits.balance(member.workspaceId);
  }

  @Get("workspaces/:workspaceId/credits/ledger")
  @Roles("ADMIN")
  @ApiPageQuery()
  @ApiQuery({ name: "type", required: false, enum: ["CHARGE", "DEBIT", "REFUND", "ADJUST"] })
  ledger(
    @CurrentMember() member: WorkspaceMember,
    @Query(new ZodPipe(ledgerQuerySchema)) query: z.infer<typeof ledgerQuerySchema>,
  ) {
    return this.credits.listLedger(member.workspaceId, query, query.type);
  }

  /** Manual correction by a platform operator. Retries must reuse the same Idempotency-Key. */
  @Post("admin/workspaces/:workspaceId/credits/adjustments")
  @UseGuards(OperatorGuard)
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiZodBody(adjustmentSchema)
  adjust(
    @Req() request: RequestWithUser,
    @Param("workspaceId") workspaceId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Body(new ZodPipe(adjustmentSchema)) body: z.infer<typeof adjustmentSchema>,
  ) {
    if (!requestKey || !/^[\w-]{8,128}$/.test(requestKey)) {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key header (8-128 chars) is required.");
    }
    return this.credits.adjust(workspaceId, getUserId(request), body.amount, body.memo, requestKey);
  }
}
