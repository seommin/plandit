import type { IncomingMessage, ServerResponse } from "http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { ErrorCode } from "../common/api-error";
import { Public } from "../common/public.decorator";
import { ApiErrors } from "../common/swagger";
import { ApiKeyGuard, CurrentApiKey } from "./api-key.guard";
import type { ApiKeyPrincipal } from "./api-key.service";
import { McpService } from "./mcp.service";

/**
 * MCP over Streamable HTTP, stateless: every POST gets a fresh server and transport, so any api instance can answer
 * and nothing is kept between requests. Replies are plain JSON (no SSE stream).
 */
@ApiTags("공개 API (v1)")
@ApiBearerAuth("api-key")
@ApiErrors(ErrorCode.RATE_LIMITED)
@Public()
@UseGuards(ApiKeyGuard)
@Controller("v1/mcp")
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @ApiOperation({
    summary: "MCP 서버 (Streamable HTTP)",
    description:
      "AI 일정 비서의 도구(캘린더·멤버·일정 조회, 빈 시간 찾기, 일정 만들기)를 MCP로 쓴다. 본문은 JSON-RPC 2.0(`initialize`, `tools/list`, `tools/call`). 세션 없음. 키의 워크스페이스 일정만 보이고, 읽기 도구는 `events:read`, `create_event`는 `events:write` 스코프가 있어야 목록에 나온다. 일정 만들기는 바로 실행된다(도구를 부르기 전 사용자 확인은 MCP 클라이언트가 한다). 크레딧은 쓰지 않는다. 연결: `claude mcp add --transport http plandit <주소>/v1/mcp --header \"Authorization: Bearer pk_…\"`",
  })
  @ApiBody({ schema: { type: "object" }, examples: { "tools/list": { value: { jsonrpc: "2.0", id: 1, method: "tools/list" } } } })
  @ApiOkResponse({ example: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "list_events", description: "…", inputSchema: { type: "object" } }] } } })
  async handle(@CurrentApiKey() key: ApiKeyPrincipal, @Req() req: IncomingMessage & { body?: unknown }, @Res() res: ServerResponse) {
    const server = await this.mcp.serverFor(key);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => void Promise.all([transport.close(), server.close()]));
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** No server-to-client stream in stateless mode; 405 tells MCP clients not to wait for one. */
  @Get()
  @ApiOperation({ summary: "MCP 알림 스트림 (지원 안 함, 405)", description: "세션 없는 서버라 서버 → 클라이언트 SSE 스트림이 없다. MCP 클라이언트는 405를 보고 스트림 없이 계속한다." })
  stream(@Res() res: ServerResponse) {
    res.writeHead(405, { allow: "POST", "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  }
}
