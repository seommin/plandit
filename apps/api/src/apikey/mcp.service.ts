import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { type CallToolResult, CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { prisma } from "@plandit/database/prisma";
import type { ApiKeyScope } from "@plandit/shared/api-keys";

import { toLlmJsonSchema } from "../ai/llm-client";
import { ASSISTANT_TOOLS, type Tool, type ToolContext, ToolError } from "../assistant/assistant-tools";
import type { ApiKeyPrincipal } from "./api-key.service";

const scopeOf = (tool: Tool<unknown>): ApiKeyScope => (tool.write ? "events:write" : "events:read");

const text = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  ...(isError ? { isError } : { structuredContent: value as Record<string, unknown> }),
});

/**
 * The in-app assistant's tools as an MCP server (PLANDIT-23), for one API key: only the tools its scopes allow, only
 * its workspace's events. The MCP client's own model does the thinking, so nothing here is metered — the key's request
 * limit applies. A change runs at once: asking the person before a tool call is the MCP host's job.
 */
@Injectable()
export class McpService {
  async serverFor(key: ApiKeyPrincipal) {
    const { timezone } = await prisma.user.findUniqueOrThrow({ where: { id: key.userId }, select: { timezone: true } });
    const tools = ASSISTANT_TOOLS.filter((tool) => key.scopes.includes(scopeOf(tool)));

    const server = new Server(
      { name: "plandit", version: "0.1.0" },
      {
        capabilities: { tools: {} },
        instructions: `Plandit 캘린더(이 API 키의 워크스페이스). 사용자 시간대 ${timezone}. 시각은 오프셋을 붙여 보낸다. 빈 시간은 사용자가 볼 수 있는 일정 기준이다.`,
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toLlmJsonSchema(tool.input, "input") as { type: "object" },
        annotations: { readOnlyHint: !tool.write, destructiveHint: false, openWorldHint: false },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) {
        const known = ASSISTANT_TOOLS.find((t) => t.name === params.name);
        return text(known ? `This API key needs the ${scopeOf(known)} scope for ${known.name}.` : `Unknown tool: ${params.name}`, true);
      }
      const ctx: ToolContext = { userId: key.userId, workspaceId: key.workspaceId, timezone, now: new Date(), workspaceOnly: true };
      try {
        const parsed = tool.input.safeParse(params.arguments ?? {});
        if (!parsed.success) throw new ToolError(`Invalid input: ${z.prettifyError(parsed.error)}`);
        return text(tool.write ? await prisma.$transaction((tx) => tool.run(tx, ctx, parsed.data)) : await tool.run(ctx, parsed.data));
      } catch (error) {
        if (!(error instanceof ToolError)) throw error; // not the caller's fault: a JSON-RPC error, logged by the SDK
        return text(error.message, true);
      }
    });
    return server;
  }
}
