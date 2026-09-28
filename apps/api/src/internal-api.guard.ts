import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "crypto";

import { IS_PUBLIC } from "./common/public.decorator";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class InternalApiGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const expectedSecret = process.env.API_INTERNAL_SECRET;
    const receivedSecret = request.headers["x-api-secret"];

    if (!expectedSecret) {
      throw new UnauthorizedException("API_INTERNAL_SECRET is not configured.");
    }

    if (typeof receivedSecret !== "string" || !safeEqual(receivedSecret, expectedSecret)) {
      throw new UnauthorizedException("Invalid internal API secret.");
    }

    return true;
  }
}
