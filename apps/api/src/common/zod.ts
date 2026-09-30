import { type PipeTransform } from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { z } from "zod";

import { ApiError, ErrorCode } from "./api-error";

export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        "Invalid request.",
        result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }

    return result.data;
  }
}

export function toOpenApi(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" }) as SchemaObject;
}

/** Request body in the docs from the zod schema; `example` is what the docs page pre-fills. */
export const ApiZodBody = (schema: z.ZodType, example?: unknown) => ApiBody({ schema: example === undefined ? toOpenApi(schema) : { ...toOpenApi(schema), example } });
