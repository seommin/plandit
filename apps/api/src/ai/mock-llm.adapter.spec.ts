import { z } from "zod";

import { LlmError, toLlmJsonSchema } from "./llm-client";
import { MOCK_MODEL, MockLlmAdapter, sampleFor } from "./mock-llm.adapter";

const itinerary = z.object({
  timezone: z.string().min(3),
  days: z
    .array(
      z.object({
        date: z.iso.date(),
        items: z.array(z.object({ title: z.string().min(1), category: z.enum(["MOVE", "MEAL", "SIGHT"]), note: z.string().optional() })).min(2),
      }),
    )
    .min(1),
  count: z.number().int().min(3),
  nickname: z.string().nullable(),
  confirmed: z.boolean(),
});

const request = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxOutputTokens: 500 };

describe("MockLlmAdapter", () => {
  it("answers a JSON Schema request with a document the same zod schema accepts", async () => {
    const schema = toLlmJsonSchema(itinerary);
    expect(schema).not.toHaveProperty("$schema");

    const sample = sampleFor(schema);
    expect(itinerary.safeParse(sample).success).toBe(true);
    expect(sample).toMatchObject({ count: 3, confirmed: false, days: [{ date: "2026-01-01", items: [{ category: "MOVE" }, { category: "MOVE" }] }] });

    const result = await new MockLlmAdapter().complete({ ...request, jsonSchema: schema });
    expect(itinerary.parse(JSON.parse(result.text))).toEqual(sample);
    expect(result).toMatchObject({ model: MOCK_MODEL, stopReason: "end" });
    expect(result.attempts[0].inputTokens).toBeGreaterThan(0);
  });

  it("plays scripted replies in order, then falls back to the default, counting calls", async () => {
    const llm = new MockLlmAdapter();
    llm.enqueue({ error: "LLM_OVERLOADED" }, { text: "짧게", stopReason: "refusal" });

    await expect(llm.complete(request)).rejects.toEqual(expect.any(LlmError));
    await expect(llm.complete(request)).resolves.toMatchObject({ text: "짧게", stopReason: "refusal" });
    await expect(llm.complete(request)).resolves.toMatchObject({ text: "모의 응답이에요.", stopReason: "end" });
    expect(llm.calls).toBe(3);

    llm.reset();
    expect(llm.calls).toBe(0);
  });

  it("keeps a call in flight until its wait settles", async () => {
    const llm = new MockLlmAdapter();
    let release!: () => void;
    llm.enqueue({ wait: new Promise<void>((resolve) => (release = resolve)) });

    let done = false;
    const call = llm.complete(request).then(() => (done = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);
    release();
    await call;
    expect(done).toBe(true);
  });
});
