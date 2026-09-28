import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { getUserId, type RequestWithUser } from "../request-user";
import { ApiError, ErrorCode } from "./api-error";

/** Platform operators (not workspace admins): emails listed in PLATFORM_ADMIN_EMAILS. */
@Injectable()
export class OperatorGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const userId = getUserId(context.switchToHttp().getRequest<RequestWithUser>());
    const operators = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

    if (!user || !operators.includes(user.email.toLowerCase())) {
      throw new ApiError(ErrorCode.FORBIDDEN, "Platform operators only.");
    }
    return true;
  }
}
