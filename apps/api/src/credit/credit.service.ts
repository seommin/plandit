import { Injectable } from "@nestjs/common";

import { type CreditLedger, type LedgerType, prisma } from "@plandit/database/prisma";

import { AuditService } from "../audit/audit.service";
import { ApiError, ErrorCode } from "../common/api-error";
import type { PageQuery } from "../common/pagination";
import { LedgerService } from "./ledger.service";

export function toLedgerDto(entry: CreditLedger) {
  return {
    id: entry.id.toString(),
    type: entry.type,
    amount: Number(entry.amount),
    balanceAfter: Number(entry.balanceAfter),
    refType: entry.refType,
    refId: entry.refId,
    memo: entry.memo,
    createdById: entry.createdById,
    createdAt: entry.createdAt,
  };
}

@Injectable()
export class CreditService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async accountOf(workspaceId: string) {
    const account = await prisma.creditAccount.findUnique({ where: { workspaceId } });
    if (!account) throw new ApiError(ErrorCode.NOT_FOUND, "Credit account not found.");
    return account;
  }

  async balance(workspaceId: string) {
    const account = await this.accountOf(workspaceId);
    return { accountId: account.id, balance: Number(account.balance), updatedAt: account.updatedAt };
  }

  /** Newest first by default. Cursor is the ledger id (bigint as string). */
  async listLedger(workspaceId: string, page: PageQuery, type?: LedgerType) {
    const account = await this.accountOf(workspaceId);
    if (page.cursor && !/^\d+$/.test(page.cursor)) {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, "Invalid cursor.");
    }
    const cursorId = page.cursor ? BigInt(page.cursor) : undefined;
    const order = page.order;

    const rows = await prisma.creditLedger.findMany({
      where: {
        accountId: account.id,
        ...(type ? { type } : {}),
        ...(cursorId !== undefined ? { id: order === "desc" ? { lt: cursorId } : { gt: cursorId } } : {}),
      },
      orderBy: { id: order },
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit);
    return {
      items: items.map(toLedgerDto),
      nextCursor: rows.length > page.limit ? items[items.length - 1].id.toString() : null,
    };
  }

  async adjust(workspaceId: string, operatorId: string, amount: number, memo: string, requestKey: string) {
    const account = await this.accountOf(workspaceId);
    return prisma.$transaction(async (tx) => {
      const { entry, replayed } = await this.ledger.append(
        {
          accountId: account.id,
          type: "ADJUST",
          amount,
          refType: "MANUAL",
          refId: requestKey,
          idempotencyKey: `MANUAL:${workspaceId}:${requestKey}`,
          memo,
          createdById: operatorId,
        },
        tx,
      );
      if (!replayed) {
        await this.audit.record(
          {
            action: "credit.adjusted",
            workspaceId,
            actorId: operatorId,
            targetType: "credit_ledger",
            targetId: entry.id.toString(),
            payload: { amount, memo, balanceAfter: Number(entry.balanceAfter), requestKey },
          },
          tx,
        );
      }
      return { entry: toLedgerDto(entry), replayed };
    });
  }
}
