import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { configureApp } from "./setup";

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule, { bufferLogs: true }));
  await app.listen(Number(process.env.API_PORT ?? 4000), "0.0.0.0");
}

void bootstrap();
