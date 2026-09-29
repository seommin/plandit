import { createHash, randomBytes } from "crypto";

import { Injectable } from "@nestjs/common";
import type { z } from "zod";

import { type ApiKey, prisma, type WorkspaceMember } from "@plandit/database/prisma";
import type { ApiKeyScope, apiKeyCreateSchema } from "@plandit/shared/api-keys";
import { roleCovers } from "@plandit/shared/workspaces";

import { AuditService } from "../audit/audit.service";
import { ApiError, ErrorCode } from "../common/api-error";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";

/** A 192-bit random token needs no slow hash (unlike passwords): SHA-256 is enough to make a DB leak useless. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ApiKeyPrincipal = { keyId: string; workspaceId: string; userId: string; scopes: ApiKeyScope[] };

export function toApiKeyDto(key: ApiKey & { user?: { id: string; name: string | null; email: string } }) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
    ...(key.user ? { owner: key.user } : {}),
  };
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly audit: AuditService) {}

  /** Returns the token exactly once; only its hash is stored. */
  async create(member: WorkspaceMember, input: z.infer<typeof apiKeyCreateSchema>) {
    const token = `pk_${randomBytes(24).toString("base64url")}`;
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;

    const key = await prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          workspaceId: member.workspaceId,
          userId: member.userId,
          name: input.name,
          prefix: token.slice(0, 11),
          keyHash: hashToken(token),
          scopes: input.scopes,
          expiresAt,
        },
      });
      await this.audit.record(
        {
          action: "api_key.created",
          workspaceId: member.workspaceId,
          actorId: member.userId,
          targetType: "api_key",
          targetId: created.id,
          payload: { name: input.name, prefix: created.prefix, scopes: input.scopes, expiresAt: expiresAt?.toISOString() ?? null },
        },
        tx,
      );
      return created;
    });
    return { apiKey: toApiKeyDto(key), token };
  }

  /** Members see their own keys; ADMIN+ see every key in the workspace (to audit and revoke). */
  async list(member: WorkspaceMember, page: PageQuery) {
    const rows = await prisma.apiKey.findMany({
      where: { workspaceId: member.workspaceId, ...(roleCovers(member.role, "ADMIN") ? {} : { userId: member.userId }) },
      include: { user: { select: { id: true, name: true, email: true } } },
      ...pageArgs(page),
    });
    const { items, nextCursor } = toPage(rows, page.limit, (row) => row.id);
    return { items: items.map(toApiKeyDto), nextCursor };
  }

  async revoke(member: WorkspaceMember, keyId: string) {
    const key = await prisma.apiKey.findFirst({
      where: { id: keyId, workspaceId: member.workspaceId, ...(roleCovers(member.role, "ADMIN") ? {} : { userId: member.userId }) },
    });
    if (!key) throw new ApiError(ErrorCode.NOT_FOUND, "API key not found.");
    if (key.revokedAt) return toApiKeyDto(key);

    return prisma.$transaction(async (tx) => {
      const revoked = await tx.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        {
          action: "api_key.revoked",
          workspaceId: member.workspaceId,
          actorId: member.userId,
          targetType: "api_key",
          targetId: key.id,
          payload: { name: key.name, prefix: key.prefix, ownerId: key.userId },
        },
        tx,
      );
      return toApiKeyDto(revoked);
    });
  }

  /**
   * null for unknown, revoked or expired keys — and for keys whose owner has left the workspace:
   * a key can never do more than its owner currently can.
   */
  async authenticate(token: string): Promise<ApiKeyPrincipal | null> {
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(token) } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) return null;

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: key.workspaceId, userId: key.userId } },
      select: { id: true },
    });
    if (!membership) return null;

    // Throttled: at most one write per key per minute, not one per request.
    await prisma.apiKey.updateMany({
      where: { id: key.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 60_000) } }] },
      data: { lastUsedAt: new Date() },
    });
    return { keyId: key.id, workspaceId: key.workspaceId, userId: key.userId, scopes: key.scopes as ApiKeyScope[] };
  }
}
