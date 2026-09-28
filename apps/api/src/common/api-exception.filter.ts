import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";

import { ApiError, ErrorCode } from "./api-error";

/** Generic codes for plain Nest HttpExceptions (thrown by older controllers). */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

export type ErrorBody = { code: ErrorCode; message: string; details?: unknown };

export function toErrorBody(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof ApiError) {
    return {
      status: exception.status,
      body: { code: exception.code, message: exception.message, details: exception.details },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      body: {
        code: CODE_BY_STATUS[status] ?? (status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_ERROR),
        message: exception.message,
      },
    };
  }

  return {
    status: 500,
    body: { code: ErrorCode.INTERNAL_ERROR, message: "Internal server error." },
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<{ id?: unknown }>();
    const response = http.getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const { status, body } = toErrorBody(exception);

    if (status >= 500) {
      this.logger.error(exception);
    }

    response.status(status).json({ ...body, traceId: String(request.id ?? "") });
  }
}
