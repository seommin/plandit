import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 4000);

  app.enableCors({
    credentials: true,
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  await app.listen(port, "0.0.0.0");
}

void bootstrap();
