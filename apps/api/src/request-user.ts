import { UnauthorizedException } from "@nestjs/common";

export type RequestWithUser = {
  headers: Record<string, string | string[] | undefined>;
};

export function getUserId(request: RequestWithUser) {
  const userId = request.headers["x-user-id"];

  if (Array.isArray(userId) || !userId) {
    throw new UnauthorizedException("Missing user context.");
  }

  return userId;
}
