import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import type { WorkspaceMember } from "@plandit/database/prisma";
import { apiKeyCreateSchema } from "@plandit/shared/api-keys";
import { eventCreateSchema } from "@plandit/shared/events";

import { ApiPageQuery, type PageQuery, pageQuerySchema } from "../common/pagination";
import { Public } from "../common/public.decorator";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { CreditService } from "../credit/credit.service";
import { CurrentMember, Roles } from "../workspace/roles";
import { ApiKeyGuard, CurrentApiKey, RequireScope } from "./api-key.guard";
import { type ApiKeyPrincipal, ApiKeyService } from "./api-key.service";
import { PublicApiService } from "./public-api.service";

/** Key management, used from the web app (internal secret + user). */
@ApiTags("api-keys")
@Controller("workspaces/:workspaceId/api-keys")
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  /** The response contains the token; it is never shown again. */
  @Post()
  @Roles("MEMBER")
  @ApiZodBody(apiKeyCreateSchema)
  create(@CurrentMember() member: WorkspaceMember, @Body(new ZodPipe(apiKeyCreateSchema)) body: z.infer<typeof apiKeyCreateSchema>) {
    return this.keys.create(member, body);
  }

  @Get()
  @Roles("MEMBER")
  @ApiPageQuery()
  list(@CurrentMember() member: WorkspaceMember, @Query(new ZodPipe(pageQuerySchema)) page: PageQuery) {
    return this.keys.list(member, page);
  }

  /** Own keys, or any key in the workspace for ADMIN+. */
  @Delete(":keyId")
  @Roles("MEMBER")
  async revoke(@CurrentMember() member: WorkspaceMember, @Param("keyId") keyId: string) {
    return { apiKey: await this.keys.revoke(member, keyId) };
  }
}

const eventsQuerySchema = pageQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Public API for scripts and integrations: `Authorization: Bearer pk_…`. */
@ApiTags("public api (v1)")
@ApiBearerAuth("api-key")
@Public()
@UseGuards(ApiKeyGuard)
@Controller("v1")
export class PublicApiController {
  constructor(
    private readonly api: PublicApiService,
    private readonly credits: CreditService,
  ) {}

  @Get("events")
  @RequireScope("events:read")
  @ApiPageQuery()
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  events(@CurrentApiKey() key: ApiKeyPrincipal, @Query(new ZodPipe(eventsQuerySchema)) query: z.infer<typeof eventsQuerySchema>) {
    return this.api.listEvents(key, query, query);
  }

  @Post("events")
  @RequireScope("events:write")
  @ApiZodBody(eventCreateSchema)
  async createEvent(@CurrentApiKey() key: ApiKeyPrincipal, @Body(new ZodPipe(eventCreateSchema)) body: z.infer<typeof eventCreateSchema>) {
    return { event: await this.api.createEvent(key, body) };
  }

  @Get("credits")
  @RequireScope("credits:read")
  balance(@CurrentApiKey() key: ApiKeyPrincipal) {
    return this.credits.balance(key.workspaceId);
  }
}
