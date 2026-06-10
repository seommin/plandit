import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { getConnectionString } from "./connection-string";

const globalForAuthPrisma = globalThis as unknown as {
  authPrisma?: PrismaClient;
};

const adapter = new PrismaPg({ connectionString: getConnectionString() });

export const authPrisma =
  globalForAuthPrisma.authPrisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForAuthPrisma.authPrisma = authPrisma;
}
