import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { prisma } from "@plandit/database/prisma";

import { AppModule } from "../src/app.module";
import { redis } from "../src/redis";
import { configureApp } from "../src/setup";

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
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
    delete: (url: string) => withHeaders(request(server).delete(url)),
  };
}

export async function registerUser(app: INestApplication, name: string) {
  const response = await request(app.getHttpServer())
    .post("/auth/register")
    .set("x-api-secret", secret())
    .send({ name, email: `${name}@test.plandit.dev`, password: "password1234" })
    .expect(201);
  return response.body.user as { id: string; name: string; email: string };
}
