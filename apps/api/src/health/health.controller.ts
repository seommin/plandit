import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { prisma } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { Public } from "../common/public.decorator";
import { ApiErrors } from "../common/swagger";
import { redis } from "../redis";

@ApiTags("상태")
@Public()
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({
    summary: "헬스 체크",
    description: "인증 없이 부른다. DB(`SELECT 1`)와 Redis(`PING`)를 확인하고, 하나라도 실패하면 503과 함께 `details`에 어느 쪽이 죽었는지(`db`/`redis`: ok·down) 준다.",
  })
  @ApiOkResponse({ example: { status: "ok", db: "ok", redis: "ok" } })
  @ApiErrors(ErrorCode.SERVICE_UNAVAILABLE)
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
