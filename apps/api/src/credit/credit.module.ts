import { Module } from "@nestjs/common";

import { CreditController } from "./credit.controller";
import { CreditService } from "./credit.service";
import { LedgerCheckService } from "./ledger-check.service";
import { LedgerService } from "./ledger.service";

@Module({
  controllers: [CreditController],
  providers: [LedgerService, CreditService, LedgerCheckService],
  exports: [LedgerService, CreditService, LedgerCheckService],
})
export class CreditModule {}
