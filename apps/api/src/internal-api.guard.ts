import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

@Injectable()
export class InternalApiGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const expectedSecret = process.env.API_INTERNAL_SECRET;
    const receivedSecret = request.headers["x-api-secret"];

    if (!expectedSecret) {
      throw new UnauthorizedException("API_INTERNAL_SECRET is not configured.");
    }

    if (receivedSecret !== expectedSecret) {
      throw new UnauthorizedException("Invalid internal API secret.");
    }

    return true;
  }
}
