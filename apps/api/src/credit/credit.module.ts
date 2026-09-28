import { Module } from "@nestjs/common";

import { CreditController } from "./credit.controller";
import { CreditService } from "./credit.service";
import { LedgerService } from "./ledger.service";

@Module({
  controllers: [CreditController],
  providers: [LedgerService, CreditService],
  exports: [LedgerService],
})
export class CreditModule {}
