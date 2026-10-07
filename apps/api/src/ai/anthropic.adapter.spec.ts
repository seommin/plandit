import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";

import { AnthropicAdapter } from "./anthropic.adapter";
import { LlmError } from "./llm-client";

type Seen = { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
type Handler = (seen: Seen, res: ServerResponse) => void;

/** A stand-in for the Messages API on localhost: records each request and answers with `handler`. */
async function fakeApi(handler: Handler) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const request = { path: req.url ?? "", headers: req.headers, body: JSON.parse(raw || "{}") };
      seen.push(request);
      handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, baseURL, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: '{"ok":' }, { type: "text", text: "true}" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ...overrides,
});

const adapter = (baseURL: string, overrides: Partial<ConstructorParameters<typeof AnthropicAdapter>[0]> = {}) =>
  new AnthropicAdapter({ model: "claude-opus-5-5", refusalFallback: true, timeoutMs: 2_000, maxRetries: 0, apiKey: "test-key", baseURL, ...overrides });

const request = { system: "sys", messages: [{ role: "user" as const, content: "안녕" }], maxOutputTokens: 1_000 };

describe("AnthropicAdapter", () => {
  it("sends structured output, explicit effort and the default refusal fallback", async () => {
    const api = await fakeApi((_, res) => json(res, 200, message()));
    try {
      const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
      const result = await adapter(api.baseURL).complete({ ...request, jsonSchema: schema });

      const [sent] = api.seen;
      expect(sent.path).toBe("/v1/messages?beta=true");
      expect(sent.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
      expect(sent.body).toMatchObject({
        model: "claude-opus-5-5",
        max_tokens: 1_000,
        system: "sys",
        messages: [{ role: "user", content: "안녕" }],
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
        fallbacks: "default",
      });
      expect(sent.body).not.toHaveProperty("tool_choice");
      expect(sent.body).not.toHaveProperty("thinking");

      expect(result).toEqual({
        model: "claude-opus-5-5",
        text: '{"ok":true}',
        stopReason: "end",
        toolCalls: [],
        replay: [{ type: "text", text: '{"ok":' }, { type: "text", text: "true}" }],
        attempts: [{ model: "claude-opus-5-5", inputTokens: 120, outputTokens: 45, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }],
      });
    } finally {
      await api.close();
    }
  });

  it("sends strict tools and caching, replays the assistant turn verbatim, and returns tool calls", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
    const toolUse = { type: "tool_use", id: "toolu_2", name: "find_free_slots", input: { fromDate: "2026-10-08" } };
    const api = await fakeApi((_, res) => json(res, 200, message({ content: [thinking, toolUse], stop_reason: "tool_use" })));
    try {
      const earlier = [thinking, { type: "tool_use", id: "toolu_1", name: "list_calendars", input: {} }];
      const result = await adapter(api.baseURL).complete({
        ...request,
        messages: [
          { role: "user", content: "회의 잡아줘" },
          { role: "assistant", content: "", replay: earlier },
          { role: "user", content: "", toolResults: [{ toolCallId: "toolu_1", content: '{"calendars":[]}' }] },
        ],
        tools: [{ name: "list_calendars", description: "캘린더", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
        cache: true,
      });

      expect(api.seen[0].body).toMatchObject({
        tools: [{ name: "list_calendars", description: "캘린더", input_schema: { type: "object", properties: {} }, strict: true }],
        cache_control: { type: "ephemeral" },
        messages: [
          { role: "user", content: "회의 잡아줘" },
          { role: "assistant", content: earlier },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"calendars":[]}', is_error: false }] },
        ],
      });
      expect(api.seen[0].body).not.toHaveProperty("tool_choice");
      expect(result).toMatchObject({
        text: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "toolu_2", name: "find_free_slots", input: { fromDate: "2026-10-08" } }],
        replay: [thinking, toolUse],
      });
    } finally {
      await api.close();
    }
  });

  it("drops the fallback beta and parameter when LLM_REFUSAL_FALLBACK is off, and lists only the configured model", async () => {
    const api = await fakeApi((_, res) => json(res, 200, message()));
    try {
      const llm = adapter(api.baseURL, { refusalFallback: false });
      await llm.complete({ ...request, effort: "low" });
      expect(api.seen[0].headers["anthropic-beta"]).toBeUndefined();
      expect(api.seen[0].body).not.toHaveProperty("fallbacks");
      expect(api.seen[0].body).toMatchObject({ output_config: { effort: "low" } });
      expect(llm.servingModels).toEqual(["claude-opus-5-5"]);
      expect(adapter(api.baseURL).servingModels).toEqual(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
    } finally {
      await api.close();
    }
  });

  it("bills from usage.iterations when a fallback model served the reply", async () => {
    const iterations = [
      { type: "message", model: "claude-opus-5-5", input_tokens: 300, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      { type: "fallback_message", model: "claude-opus-5", input_tokens: 300, output_tokens: 80, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, cache_creation: null },
    ];
    const api = await fakeApi((_, res) =>
      json(res, 200, message({ model: "claude-opus-5", usage: { input_tokens: 300, output_tokens: 80, iterations } })),
    );
    try {
      const result = await adapter(api.baseURL).complete(request);
      expect(result.model).toBe("claude-opus-5");
      expect(result.attempts).toEqual([
        { model: "claude-opus-5-5", inputTokens: 300, outputTokens: 12, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
        { model: "claude-opus-5", inputTokens: 300, outputTokens: 80, cacheReadInputTokens: 50, cacheWriteInputTokens: 0 },
      ]);
    } finally {
      await api.close();
    }
  });

  it.each([
    ["refusal", "refusal"],
    ["tool_use", "tool_use"],
    ["max_tokens", "max_tokens"],
    ["model_context_window_exceeded", "max_tokens"],
    ["stop_sequence", "end"],
    ["pause_turn", "other"],
  ])("maps stop_reason %s to %s", async (stop, expected) => {
    const api = await fakeApi((_, res) => json(res, 200, message({ stop_reason: stop, content: [] })));
    try {
      expect((await adapter(api.baseURL).complete(request)).stopReason).toBe(expected);
    } finally {
      await api.close();
    }
  });

  it.each([
    [400, "invalid_request_error", "LLM_BAD_REQUEST"],
    [401, "authentication_error", "LLM_AUTH"],
    [403, "permission_error", "LLM_AUTH"],
    [429, "rate_limit_error", "LLM_RATE_LIMITED"],
    [500, "api_error", "LLM_UNAVAILABLE"],
    [529, "overloaded_error", "LLM_OVERLOADED"],
  ])("classifies HTTP %i as %s", async (status, type, code) => {
    const api = await fakeApi((_, res) => json(res, status, { type: "error", error: { type, message: "nope" } }));
    try {
      const error = await adapter(api.baseURL).complete(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmError);
      expect(error).toMatchObject({ code });
      expect((error as LlmError).message).toContain(`(${status})`);
    } finally {
      await api.close();
    }
  });

  it("classifies a slow response as LLM_TIMEOUT and an unreachable host as LLM_UNAVAILABLE", async () => {
    const api = await fakeApi((_, res) => setTimeout(() => json(res, 200, message()), 500));
    try {
      await expect(adapter(api.baseURL, { timeoutMs: 100 }).complete(request)).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    } finally {
      await api.close();
    }
    await expect(adapter("http://127.0.0.1:9").complete(request)).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
  });
});
