import { Injectable } from "@nestjs/common";

import { Prisma, prisma } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import type { PageQuery } from "../common/pagination";
import { requestContext } from "../common/request-context";

export type AuditAction =
  | "workspace.created"
  | "workspace.renamed"
  | "workspace.member_added"
  | "workspace.member_role_changed"
  | "workspace.member_removed"
  | "credit.adjusted"
  | "payment.approved"
  | "payment.failed"
  | "payment.expired";

export type AuditEntry = {
  action: AuditAction;
  workspaceId: string | null;
  /** omit/null for system actions (webhooks, jobs) */
  actorId?: string | null;
  targetType: string;
  targetId: string;
  payload?: Prisma.InputJsonValue;
};

type Db = Prisma.TransactionClient | typeof prisma;

@Injectable()
export class AuditService {
  /**
   * Pass the transaction that makes the change: the audit row then exists if and only if the change committed.
   * traceId / ip / user agent come from the current request (none inside jobs).
   */
  record(entry: AuditEntry, db: Db = prisma) {
    const context = requestContext.getStore();
    return db.auditLog.create({
      data: {
        ...entry,
        actorId: entry.actorId ?? null,
        traceId: context?.traceId,
        ip: context?.ip,
        userAgent: context?.userAgent,
      },
    });
  }

  /** Newest first. `action` matches exactly, or as a prefix when it ends with "." (e.g. "payment."). */
  async list(workspaceId: string, page: PageQuery, action?: string) {
    if (page.cursor && !/^\d+$/.test(page.cursor)) throw new ApiError(ErrorCode.VALIDATION_FAILED, "Invalid cursor.");
    const cursorId = page.cursor ? BigInt(page.cursor) : undefined;

    const rows = await prisma.auditLog.findMany({
      where: {
        workspaceId,
        ...(action ? { action: action.endsWith(".") ? { startsWith: action } : action } : {}),
        ...(cursorId !== undefined ? { id: page.order === "desc" ? { lt: cursorId } : { gt: cursorId } } : {}),
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { id: page.order },
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit);
    return {
      items: items.map(({ id, actorId: _actorId, ...row }) => ({ id: id.toString(), ...row })),
      nextCursor: rows.length > page.limit ? items[items.length - 1].id.toString() : null,
    };
  }
}
