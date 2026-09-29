import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { ApiKeyScope } from "@plandit/shared/api-keys";

import { ApiError, ErrorCode } from "../common/api-error";
import { hitRateLimit } from "../common/rate-limit";
import { type ApiKeyPrincipal, ApiKeyService } from "./api-key.service";

const SCOPE_KEY = "apiKeyScope";

/** The scope a /v1 handler needs. */
export const RequireScope = (scope: ApiKeyScope) => SetMetadata(SCOPE_KEY, scope);

type Req = { headers: Record<string, string | string[] | undefined>; apiKey?: ApiKeyPrincipal };
type Res = { setHeader(name: string, value: string | number): void };

export const CurrentApiKey = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<Req>().apiKey as ApiKeyPrincipal,
);

/**
 * `Authorization: Bearer pk_…` → key (401, same body for every reason) → per-key rate limit (429 + Retry-After)
 * → scope (403). Used only on the public /v1 controller, which is @Public() for the internal-secret guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Req>();
    const response = context.switchToHttp().getResponse<Res>();

    const header = request.headers.authorization;
    const token = typeof header === "string" ? /^Bearer (pk_[\w-]{10,64})$/.exec(header)?.[1] : undefined;
    const principal = token ? await this.keys.authenticate(token) : null;
    if (!principal) throw new ApiError(ErrorCode.UNAUTHORIZED, "Invalid API key.");

    const limit = await hitRateLimit(`api-key:${principal.keyId}`, Number(process.env.API_KEY_RATE_LIMIT_PER_MIN ?? 60));
    response.setHeader("x-ratelimit-limit", limit.limit);
    response.setHeader("x-ratelimit-remaining", limit.remaining);
    if (!limit.allowed) {
      response.setHeader("retry-after", limit.resetSeconds);
      throw new ApiError(ErrorCode.RATE_LIMITED, "Too many requests for this API key.", { retryAfterSeconds: limit.resetSeconds });
    }

    const required = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (required && !principal.scopes.includes(required)) {
      throw new ApiError(ErrorCode.FORBIDDEN, `This API key does not have the ${required} scope.`);
    }

    request.apiKey = principal;
    return true;
  }
}
