import "reflect-metadata";

import { createServer } from "http";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { register } from "./metrics/metrics";
import { WorkerModule } from "./worker/worker.module";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // The worker has no HTTP app; a bare server exposes its own counters (sends, retries, ledger appends) to Prometheus.
  const port = process.env.WORKER_METRICS_PORT;
  if (port) {
    const server = createServer(async (req, res) => {
      if (req.url !== "/metrics") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": register.contentType }).end(await register.metrics());
    }).listen(Number(port), "0.0.0.0");
    app.get(Logger).log(`Worker metrics on :${port}/metrics`);
    process.once("SIGTERM", () => server.close());
  }
}

void bootstrap();
