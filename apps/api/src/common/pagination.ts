import { applyDecorators } from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { z } from "zod";

/** Cursor pagination over (createdAt, id). `cursor` is the id of the last item of the previous page. */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageArgs({ cursor, limit, order }: PageQuery) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: order }, { id: order }],
  };
}

export function toPage<T>(rows: T[], limit: number, idOf: (row: T) => string) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? idOf(items[items.length - 1]) : null };
}

export const ApiPageQuery = () =>
  applyDecorators(
    ApiQuery({ name: "cursor", required: false, type: String }),
    ApiQuery({ name: "limit", required: false, type: Number, example: 20 }),
    ApiQuery({ name: "order", required: false, enum: ["asc", "desc"] }),
  );
