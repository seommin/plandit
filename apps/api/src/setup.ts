import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";

import { traceMiddleware } from "./common/request-context";

/** Shared by main.ts and e2e tests so both run the exact same app wiring. */
export function configureApp(app: INestApplication) {
  app.use(traceMiddleware);
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.enableCors({
    credentials: true,
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  const config = new DocumentBuilder()
    .setTitle("Plandit API")
    .setVersion("0.1.0")
    .addApiKey({ type: "apiKey", in: "header", name: "x-api-secret" }, "internal-secret")
    .addApiKey({ type: "apiKey", in: "header", name: "x-user-id" }, "user-id")
    .addSecurityRequirements("internal-secret")
    .addSecurityRequirements("user-id")
    .build();
  SwaggerModule.setup("docs", app, () => SwaggerModule.createDocument(app, config));

  return app;
}
