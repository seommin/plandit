import express, { type NextFunction, type Request, type Response } from "express";

import type { Db } from "./db.ts";
import { type PgConfig, pgRouter } from "./pg.ts";
import { inboxRouter, type RelayConfig, relayRouter } from "./relay.ts";

export type MocksConfig = { pg: PgConfig; relay: RelayConfig };

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): MocksConfig {
  const port = Number(env.MOCKS_PORT ?? 4100);
  return {
    pg: {
      publicUrl: env.MOCKS_PUBLIC_URL ?? `http://localhost:${port}`,
      webhookUrl: env.MOCK_PG_WEBHOOK_URL ?? "http://localhost:4000/webhooks/payments/mock",
      webhookSecret: env.MOCK_PG_WEBHOOK_SECRET ?? "local-mock-pg-secret",
      slowMs: Number(env.MOCK_PG_SLOW_MS ?? 30_000),
      webhookDelayMs: Number(env.MOCK_PG_WEBHOOK_DELAY_MS ?? 10_000),
    },
    relay: {
      webhookUrl: env.MOCK_RELAY_WEBHOOK_URL ?? "http://localhost:4000/webhooks/relay/mock",
      webhookSecret: env.MOCK_RELAY_WEBHOOK_SECRET ?? "local-mock-relay-secret",
      failRate: Number(env.RELAY_FAIL_RATE ?? 0.1),
      delayMs: Number(env.RELAY_DELAY_MS ?? 3_000),
      rps: Number(env.RELAY_RPS ?? 20),
    },
  };
}

export function createApp(db: Db, config: MocksConfig) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => void res.json({ status: "ok" }));
  app.use("/pg", pgRouter(db, config.pg));
  app.use("/relay", relayRouter(db, config.relay));
  app.use("/inbox", inboxRouter(db));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Mock server error." });
  });
  return app;
}
