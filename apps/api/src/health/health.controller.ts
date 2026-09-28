import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { prisma } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { Public } from "../common/public.decorator";
import { redis } from "../redis";

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  @Get()
  async check() {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);

    if (db.status === "rejected" || cache.status === "rejected") {
      throw new ApiError(ErrorCode.SERVICE_UNAVAILABLE, "Dependency check failed.", {
        db: db.status === "fulfilled" ? "ok" : "down",
        redis: cache.status === "fulfilled" ? "ok" : "down",
      });
    }

    return { status: "ok", db: "ok", redis: "ok" };
  }
}
