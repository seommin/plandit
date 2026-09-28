import { Prisma, prisma } from "@plandit/database/prisma";
import { PERSONAL_WORKSPACE_NAME } from "@plandit/shared/workspaces";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Returns the user's PERSONAL workspace, creating it (with OWNER membership and a credit account) if missing.
 * Users created by Auth.js OAuth never pass through /auth/register, so this runs lazily too.
 * `Workspace.personalOwnerId @unique` makes concurrent calls safe: the loser re-reads the winner's row.
 */
export async function ensurePersonalWorkspace(userId: string, db: Db = prisma) {
  const existing = await db.workspace.findUnique({ where: { personalOwnerId: userId } });
  if (existing) return existing;

  try {
    return await db.workspace.create({
      data: {
        name: PERSONAL_WORKSPACE_NAME,
        type: "PERSONAL",
        personalOwnerId: userId,
        members: { create: { userId, role: "OWNER" } },
        creditAccount: { create: {} },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return db.workspace.findUniqueOrThrow({ where: { personalOwnerId: userId } });
    }
    throw error;
  }
}
