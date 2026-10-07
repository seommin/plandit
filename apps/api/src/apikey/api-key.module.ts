import { Module } from "@nestjs/common";

import { CreditModule } from "../credit/credit.module";
import { ApiKeyController, PublicApiController } from "./api-key.controller";
import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeyService } from "./api-key.service";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";
import { PublicApiService } from "./public-api.service";

@Module({
  imports: [CreditModule],
  controllers: [ApiKeyController, PublicApiController, McpController],
  providers: [ApiKeyService, ApiKeyGuard, PublicApiService, McpService],
})
export class ApiKeyModule {}
