import "reflect-metadata";

import { spawn } from "child_process";
import type { AddressInfo } from "net";
import path from "path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { prisma } from "@plandit/database/prisma";

import { AppModule } from "../src/app.module";
import { redis } from "../src/redis";
import { configureApp } from "../src/setup";

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true, rawBody: true }));
  await app.init();
  return app;
}

export async function closeTestApp(app: INestApplication) {
  await app.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
}

/** Empties every table in the test database (migrations table excluded). */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
}

const secret = () => process.env.API_INTERNAL_SECRET ?? "";

/** Calls the API the way apps/web does: internal secret + acting user id. */
export function as(app: INestApplication, userId: string) {
  const server = app.getHttpServer();
  const withHeaders = (test: request.Test) => test.set("x-api-secret", secret()).set("x-user-id", userId);
  return {
    get: (url: string) => withHeaders(request(server).get(url)),
    post: (url: string) => withHeaders(request(server).post(url)),
    patch: (url: string) => withHeaders(request(server).patch(url)),
    put: (url: string) => withHeaders(request(server).put(url)),
    delete: (url: string) => withHeaders(request(server).delete(url)),
  };
}

export const waitFor = async <T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export const MOCK_PG_SECRET = "e2e-mock-pg-secret";
export const MOCK_RELAY_SECRET = "e2e-mock-relay-secret";

/**
 * Starts the real apps/mocks server as a child process (it never shares code with the api) and points the api
 * at it: the api listens on a random port so the mock PG can deliver webhooks back to it.
 */
export async function startMocksFor(app: INestApplication, port: number, env: Record<string, string> = {}) {
  await app.listen(0, "127.0.0.1");
  const apiPort = (app.getHttpServer().address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  process.env.MOCK_PG_BASE_URL = `${base}/pg`;
  process.env.MOCK_PG_WEBHOOK_SECRET = MOCK_PG_SECRET;
  process.env.PAYMENT_WEBHOOK_URL = `http://127.0.0.1:${apiPort}/webhooks/payments/mock`;
  process.env.MOCK_RELAY_BASE_URL = `${base}/relay`;
  process.env.MOCK_RELAY_WEBHOOK_SECRET = MOCK_RELAY_SECRET;
  process.env.RELAY_WEBHOOK_URL = `http://127.0.0.1:${apiPort}/webhooks/relay/mock`;

  const child = spawn(process.execPath, ["src/main.ts"], {
    cwd: path.resolve(__dirname, "../../mocks"),
    env: {
      ...process.env,
      MOCKS_PORT: String(port),
      MOCKS_PUBLIC_URL: base,
      MOCK_PG_WEBHOOK_SECRET: MOCK_PG_SECRET,
      MOCK_RELAY_WEBHOOK_SECRET: MOCK_RELAY_SECRET,
      MOCK_PG_WEBHOOK_DELAY_MS: "100",
      MOCK_PG_SLOW_MS: "200",
      ...env,
    },
    stdio: "ignore",
  });
  await waitFor(() => fetch(`${base}/health`).then((r) => r.ok).catch(() => false), 15_000);
  return { base, stop: () => child.kill() };
}

/** The end user pressing "approve" on the mock PG's payment page. */
export async function approveAtPg(mocksBase: string, paymentId: string) {
  const { providerTxId } = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const response = await fetch(`${mocksBase}/pg/v1/payments/${providerTxId}/confirm`, { method: "POST" });
  if (!response.ok) throw new Error(`confirm failed: ${response.status}`);
}

export async function registerUser(app: INestApplication, name: string) {
  const response = await request(app.getHttpServer())
    .post("/auth/register")
    .set("x-api-secret", secret())
    .send({ name, email: `${name}@test.plandit.dev`, password: "password1234" })
    .expect(201);
  return response.body.user as { id: string; name: string; email: string };
}
