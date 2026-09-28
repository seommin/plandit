import { z } from "zod";

export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type WorkspaceRoleName = (typeof WORKSPACE_ROLES)[number];

const RANK: Record<WorkspaceRoleName, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

/** True when `actor` is at least as privileged as `required` (OWNER > ADMIN > MEMBER). */
export function roleCovers(actor: WorkspaceRoleName, required: WorkspaceRoleName) {
  return RANK[actor] >= RANK[required];
}

export const PERSONAL_WORKSPACE_NAME = "개인 워크스페이스";

export const workspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const workspaceUpdateSchema = workspaceCreateSchema;

export const workspaceMemberAddSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(WORKSPACE_ROLES).default("MEMBER"),
});

export const workspaceMemberUpdateSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });
