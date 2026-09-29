import { Module } from "@nestjs/common";

import { CreditModule } from "../credit/credit.module";
import { ApiKeyController, PublicApiController } from "./api-key.controller";
import { ApiKeyGuard } from "./api-key.guard";
import { ApiKeyService } from "./api-key.service";
import { PublicApiService } from "./public-api.service";

@Module({
  imports: [CreditModule],
  controllers: [ApiKeyController, PublicApiController],
  providers: [ApiKeyService, ApiKeyGuard, PublicApiService],
})
export class ApiKeyModule {}
