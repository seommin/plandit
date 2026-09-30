import { z } from "zod";

import { toLlmJsonSchema } from "./llm-client";

describe("toLlmJsonSchema", () => {
  it("keeps only what structured output accepts, and closes every object", () => {
    const schema = z.object({
      date: z.iso.date(),
      time: z.string().regex(/^\d\d:\d\d$/).describe("HH:mm"),
      count: z.number().int().min(1).max(9),
      note: z.string().max(10).nullable(),
      tags: z.array(z.enum(["A", "B"])).min(1).max(3),
      nested: z.object({ ok: z.boolean() }),
    });

    expect(toLlmJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        date: { type: "string", format: "date" },
        time: { type: "string", description: "HH:mm" },
        count: { type: "integer" },
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
        tags: { type: "array", items: { type: "string", enum: ["A", "B"] } },
        nested: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      },
      required: ["date", "time", "count", "note", "tags", "nested"],
      additionalProperties: false,
    });
  });

  it("keeps a property that happens to be named like a dropped keyword", () => {
    const schema = z.object({ pattern: z.string(), minimum: z.number() });
    expect(toLlmJsonSchema(schema)).toMatchObject({ properties: { pattern: { type: "string" }, minimum: { type: "number" } } });
  });
});
