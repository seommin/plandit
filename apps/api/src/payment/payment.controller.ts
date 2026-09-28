import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { chargeSchema } from "@plandit/shared/credits";

import { ApiError, ErrorCode } from "../common/api-error";
import { ApiPageQuery, type PageQuery, pageQuerySchema } from "../common/pagination";
import { Public } from "../common/public.decorator";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { CurrentMember, Roles } from "../workspace/roles";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PaymentService } from "./payment.service";

@ApiTags("payments")
@Controller("workspaces/:workspaceId/payments")
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  /** Starts a top-up and returns the PG payment page URL. Credits arrive only via the PG webhook. */
  @Post("charge")
  @Roles("ADMIN")
  @ApiZodBody(chargeSchema)
  async charge(
    @CurrentMember() member: WorkspaceMember,
    @Body(new ZodPipe(chargeSchema)) body: z.infer<typeof chargeSchema>,
  ) {
    return { payment: await this.payments.charge(member.workspaceId, member.userId, body.amount) };
  }

  @Get()
  @Roles("ADMIN")
  @ApiPageQuery()
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    return this.payments.list(member.workspaceId, page);
  }

  @Get(":paymentId")
  @Roles("ADMIN")
  async get(@CurrentMember() member: WorkspaceMember, @Param("paymentId") paymentId: string) {
    return { payment: await this.payments.get(member.workspaceId, paymentId) };
  }
}

/** Called by the PG, not by our web app: authenticated by the HMAC signature instead of the internal secret. */
@Public()
@Controller("webhooks/payments")
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post("mock")
  @HttpCode(200)
  @ApiExcludeEndpoint()
  handle(@Req() request: { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!request.rawBody) throw new ApiError(ErrorCode.BAD_REQUEST, "Empty webhook body.");
    return this.webhooks.handle(request.rawBody, headers);
  }
}
