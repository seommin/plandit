-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('CHARGE', 'DEBIT', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "LedgerRefType" AS ENUM ('PAYMENT', 'REMINDER_DELIVERY', 'AI_USAGE', 'MANUAL');

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "refType" "LedgerRefType" NOT NULL,
    "refId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_idempotencyKey_key" ON "CreditLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditLedger_accountId_id_idx" ON "CreditLedger"("accountId", "id" DESC);

-- CreateIndex
CREATE INDEX "CreditLedger_refType_refId_idx" ON "CreditLedger"("refType", "refId");

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only ledger: reject UPDATE and DELETE at the database level.
-- (TRUNCATE is still allowed so the e2e suite can reset its own test database.)
CREATE FUNCTION credit_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CreditLedger is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON "CreditLedger"
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_append_only();
