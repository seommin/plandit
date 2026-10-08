import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";

import {
  type AssistantThread,
  type AssistantToolCall,
  Prisma,
  prisma,
  type WorkspaceMember,
} from "@plandit/database/prisma";

import { AiUsageService } from "../ai/ai-usage.service";
import { LLM_CLIENT, type LlmClient, type LlmMessage, type LlmResult } from "../ai/llm-client";
import { MockLlmAdapter } from "../ai/mock-llm.adapter";
import { ApiError, ErrorCode } from "../common/api-error";
import { MemoryService } from "../memory/memory.service";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";
import { buildAssistantRequest, isAssistantRequest, mockAssistantReply, userTurn } from "./assistant-prompt";
import { type ToolContext, ToolError, toolNamed } from "./assistant-tools";
import { AssistantQueue } from "./assistant.queue";

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 15_000 };
const json = (value: unknown) => value as Prisma.InputJsonValue;

const REJECTED = "사용자가 거절했어요.";
const SUPERSEDED = "사용자가 승인하지 않고 새 메시지를 보냈어요.";
const ABORTED = "처리 중 오류로 중단됐어요.";

/**
 * AI schedule assistant (PLANDIT-21). A message reserves the first model call with it; the worker then runs the loop
 * one step at a time — model call → tools → model call … — until the model answers without tools, a change waits for
 * the person's approval, or a limit stops it. Every step is stored, so the loop can stop and pick up again anywhere.
 */
@Injectable()
export class AssistantService implements OnModuleInit {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly usages: AiUsageService,
    private readonly queue: AssistantQueue,
    private readonly memory: MemoryService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  onModuleInit() {
    // However the pending model call fails (error, refusal, the stale sweep), the turn ends in the refund transaction.
    this.usages.onFeatureFailure("SCHEDULE_ASSISTANT", async (tx, usage) => {
      await tx.assistantThread.updateMany({
        where: { pendingUsageId: usage.id },
        data: { pendingUsageId: null, status: "IDLE", stopCode: usage.failureCode },
      });
    });
    if (this.llm instanceof MockLlmAdapter) this.llm.respondTo(isAssistantRequest, mockAssistantReply);
  }

  /** Model calls per message. Each is a separate reservation, so a long loop also stops when the credits run out. */
  private get maxSteps() {
    return Number(process.env.ASSISTANT_MAX_STEPS ?? 8);
  }

  async createThread(member: WorkspaceMember) {
    const thread = await prisma.assistantThread.create({ data: { workspaceId: member.workspaceId, userId: member.userId } });
    return this.get(member, thread.id);
  }

  /** The requester's own conversations in this workspace, newest first. */
  async list(member: WorkspaceMember, page: PageQuery) {
    const rows = await prisma.assistantThread.findMany({
      where: { workspaceId: member.workspaceId, userId: member.userId },
      ...pageArgs(page),
      select: { id: true, title: true, status: true, createdAt: true, updatedAt: true },
    });
    return toPage(rows, page.limit, (row) => row.id);
  }

  /**
   * Appends the message and reserves the first model call in one transaction (not enough credits → 409, nothing
   * stored), then hands the loop to the worker. A change still waiting for approval is treated as declined.
   */
  async postMessage(member: WorkspaceMember, threadId: string, text: string) {
    const { timezone } = await prisma.user.findUniqueOrThrow({ where: { id: member.userId }, select: { timezone: true } });
    const messageId = await prisma.$transaction(async (tx) => {
      const thread = await this.lockOwn(tx, member, threadId);
      if (thread.status === "RUNNING") throw new ApiError(ErrorCode.CONFLICT, "The assistant is still working on the last message.");
      await this.closeOpenCalls(tx, thread.id, SUPERSEDED);

      const content: LlmMessage = { role: "user", content: userTurn(text, new Date(), timezone) };
      const message = await tx.assistantMessage.create({
        data: { threadId, seq: await this.nextSeq(tx, threadId), kind: "USER", text, content: json(content) },
      });
      const usage = await this.usages.reserve(
        { workspaceId: member.workspaceId, userId: member.userId, feature: "SCHEDULE_ASSISTANT", request: buildAssistantRequest(await this.history(tx, threadId)) },
        tx,
      );
      await tx.assistantThread.update({
        where: { id: threadId },
        data: { status: "RUNNING", pendingUsageId: usage.id, stopCode: null, title: thread.title ?? text.slice(0, 40) },
      });
      return message.id;
    }, TX);
    await this.queue.enqueueRun(threadId, `message_${messageId}`);
    return this.get(member, threadId);
  }

  /**
   * Approves (runs the change, checking permissions again) or declines a change, once: a repeated click returns the
   * result of the first, the opposite decision afterwards is a 409. When nothing else waits, the loop continues.
   */
  async decide(member: WorkspaceMember, threadId: string, toolCallId: string, approve: boolean) {
    const resume = await prisma.$transaction(async (tx) => {
      const thread = await this.lockOwn(tx, member, threadId);
      const call = await tx.assistantToolCall.findFirst({ where: { id: toolCallId, threadId } });
      if (!call) throw new ApiError(ErrorCode.NOT_FOUND, "Tool call not found.");
      if (call.status !== "WAITING_APPROVAL") {
        const sameDecision = approve ? call.status === "DONE" || call.status === "ERROR" : call.status === "REJECTED";
        if (sameDecision) return false;
        throw new ApiError(ErrorCode.CONFLICT, "This change was already decided.");
      }

      const tool = toolNamed(call.name);
      let update: Prisma.AssistantToolCallUpdateInput = { status: "REJECTED", output: { error: REJECTED } };
      if (approve) {
        if (!tool?.write) throw new Error(`Tool call ${call.id} waits for approval but ${call.name} is not a change.`);
        try {
          update = { status: "DONE", output: json(await tool.run(tx, await this.contextFor(thread), tool.input.parse(call.input))) };
        } catch (error) {
          if (!(error instanceof ToolError)) throw error;
          update = { status: "ERROR", output: { error: error.message } };
        }
      }
      await tx.assistantToolCall.update({ where: { id: call.id }, data: { ...update, finishedAt: new Date() } });

      const waiting = await tx.assistantToolCall.count({ where: { messageId: call.messageId, status: "WAITING_APPROVAL" } });
      if (waiting || thread.status !== "WAITING_APPROVAL") return false;
      await tx.assistantThread.update({ where: { id: thread.id }, data: { status: "RUNNING" } });
      return true;
    }, TX);
    if (resume) await this.queue.enqueueRun(threadId, `decided_${toolCallId}`);
    return this.get(member, threadId);
  }

  /** Worker: advances a RUNNING conversation until it answers, waits for approval, or stops. Safe to run again. */
  async run(threadId: string): Promise<string> {
    for (;;) {
      const thread = await prisma.assistantThread.findUnique({ where: { id: threadId } });
      if (thread?.status !== "RUNNING") return "SKIPPED";
      if (!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: thread.workspaceId, userId: thread.userId } } }))) {
        // Left the workspace mid-turn: refund the reserved call now (its failure handler ends the turn), else just end it.
        if (thread.pendingUsageId) await this.usages.fail(thread.pendingUsageId, "NOT_A_MEMBER");
        else await this.stop(thread.id, "NOT_A_MEMBER");
        return "NOT_A_MEMBER";
      }

      if (thread.pendingUsageId) {
        const outcome = await this.callModel(thread, thread.pendingUsageId);
        if (outcome !== "SUCCEEDED") return outcome; // FAILED: the failure handler ended the turn; SKIPPED: another run owns it
        continue;
      }

      const messages = await prisma.assistantMessage.findMany({ where: { threadId }, orderBy: { seq: "asc" }, include: { toolCalls: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
      const last = messages[messages.length - 1];
      if (last?.kind === "ASSISTANT") {
        if (!last.toolCalls.length) return this.stop(thread.id, null).then(() => "ANSWERED");
        await this.runTools(thread, last.toolCalls);
        const waiting = await prisma.assistantToolCall.count({ where: { messageId: last.id, status: "WAITING_APPROVAL" } });
        if (waiting) {
          await prisma.assistantThread.updateMany({ where: { id: thread.id, status: "RUNNING" }, data: { status: "WAITING_APPROVAL" } });
          return "WAITING_APPROVAL";
        }
        // Every call has its result now: hand them to the model (a no-op if another run already did)
        await prisma.$transaction((tx) => this.lockThread(tx, thread.id).then(() => this.closeOpenCalls(tx, thread.id, ABORTED)), TX);
        continue;
      }

      // The model's turn (after the person's message or the tool results)
      const askedAt = messages.map((m) => m.kind).lastIndexOf("USER");
      const steps = messages.slice(askedAt + 1).filter((m) => m.kind === "ASSISTANT").length;
      if (steps >= this.maxSteps) {
        await this.stop(thread.id, "STEP_LIMIT");
        return "STEP_LIMIT";
      }
      try {
        await this.reserveStep(thread, messages.length);
      } catch (error) {
        const stopping = error instanceof ApiError && (error.code === ErrorCode.INSUFFICIENT_CREDITS || error.code === ErrorCode.AI_MONTHLY_LIMIT);
        if (!stopping) throw error;
        await this.stop(thread.id, error.code);
        return error.code;
      }
    }
  }

  /** Worker, after the last retry failed: end the turn so the person can write again. A pending call is left to the stale sweep. */
  async abort(threadId: string) {
    await prisma.$transaction(async (tx) => {
      const thread = await this.lockThread(tx, threadId);
      if (!thread || thread.status === "IDLE" || thread.pendingUsageId) return;
      await this.closeOpenCalls(tx, threadId, ABORTED);
      await tx.assistantThread.update({ where: { id: threadId }, data: { status: "IDLE", stopCode: "INTERNAL" } });
    }, TX);
  }

  /** Runs one reserved model call. The reply and its tool calls are stored in the settlement transaction. */
  private async callModel(thread: AssistantThread, usageId: string) {
    const request = buildAssistantRequest(await this.history(prisma, thread.id));
    const outcome = await this.usages.execute<LlmResult>(usageId, request, {
      parse: (result) => result,
      onSuccess: async (tx, result, usage) => {
        const locked = await this.lockThread(tx, thread.id);
        if (locked?.pendingUsageId !== usage.id) throw new Error(`Thread ${thread.id} is no longer waiting for usage ${usage.id}.`);
        const reply: LlmMessage = { role: "assistant", content: result.text, replay: result.replay };
        const message = await tx.assistantMessage.create({
          data: { threadId: thread.id, seq: await this.nextSeq(tx, thread.id), kind: "ASSISTANT", text: result.text || null, content: json(reply), aiUsageId: usage.id },
        });
        if (result.toolCalls.length) {
          await tx.assistantToolCall.createMany({
            data: result.toolCalls.map((call) => ({ threadId: thread.id, messageId: message.id, toolUseId: call.id, name: call.name, input: json(call.input ?? {}) })),
          });
        }
        await tx.assistantThread.update({ where: { id: thread.id }, data: { pendingUsageId: null } });
      },
    });
    return outcome.status;
  }

  /** Reads run now; a change is checked and described, then waits for the person. A bad call becomes an error result. */
  private async runTools(thread: AssistantThread, calls: AssistantToolCall[]) {
    const ctx = await this.contextFor(thread);
    for (const call of calls.filter((c) => c.status === "PENDING")) {
      let update: Prisma.AssistantToolCallUpdateManyMutationInput;
      try {
        const tool = toolNamed(call.name);
        if (!tool) throw new ToolError(`Unknown tool: ${call.name}`);
        const parsed = tool.input.safeParse(call.input);
        if (!parsed.success) throw new ToolError(`Invalid input: ${z.prettifyError(parsed.error)}`);
        update = tool.write
          ? { status: "WAITING_APPROVAL", preview: json(await tool.check(prisma, ctx, parsed.data)) }
          : { status: "DONE", output: json(await tool.run(ctx, parsed.data)), finishedAt: new Date() };
      } catch (error) {
        if (!(error instanceof ToolError)) throw error; // the database, not the call: let the job retry
        update = { status: "ERROR", output: { error: error.message }, finishedAt: new Date() };
      }
      await prisma.assistantToolCall.updateMany({ where: { id: call.id, status: "PENDING" }, data: update });
    }
  }

  /** Reserves the next model call, unless someone else already moved the conversation on. */
  private async reserveStep(thread: AssistantThread, messageCount: number) {
    await prisma.$transaction(async (tx) => {
      const locked = await this.lockThread(tx, thread.id);
      const count = await tx.assistantMessage.count({ where: { threadId: thread.id } });
      if (locked?.status !== "RUNNING" || locked.pendingUsageId || count !== messageCount) return;
      const usage = await this.usages.reserve(
        { workspaceId: thread.workspaceId, userId: thread.userId, feature: "SCHEDULE_ASSISTANT", request: buildAssistantRequest(await this.history(tx, thread.id)) },
        tx,
      );
      await tx.assistantThread.update({ where: { id: thread.id }, data: { pendingUsageId: usage.id } });
    }, TX);
  }

  /**
   * If the last reply asked for tools, answers every one of them (open ones as declined with `reason`), so the history
   * the model sees next is complete. Every tool use needs its result before anything else can follow.
   */
  private async closeOpenCalls(tx: Tx, threadId: string, reason: string) {
    const last = await tx.assistantMessage.findFirst({ where: { threadId }, orderBy: { seq: "desc" } });
    if (last?.kind !== "ASSISTANT") return;
    await tx.assistantToolCall.updateMany({
      where: { messageId: last.id, status: { in: ["PENDING", "WAITING_APPROVAL"] } },
      data: { status: "REJECTED", output: { error: reason }, finishedAt: new Date() },
    });
    const calls = await tx.assistantToolCall.findMany({ where: { messageId: last.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!calls.length) return;
    const content: LlmMessage = {
      role: "user",
      content: "",
      toolResults: calls.map((c) => ({ toolCallId: c.toolUseId, content: JSON.stringify(c.output), isError: c.status !== "DONE" })),
    };
    await tx.assistantMessage.create({ data: { threadId, seq: last.seq + 1, kind: "TOOL_RESULTS", content: json(content) } });
  }

  private async stop(threadId: string, stopCode: string | null) {
    await prisma.assistantThread.updateMany({ where: { id: threadId, status: "RUNNING", pendingUsageId: null }, data: { status: "IDLE", stopCode } });
  }

  private async contextFor(thread: AssistantThread): Promise<ToolContext> {
    const { timezone } = await prisma.user.findUniqueOrThrow({ where: { id: thread.userId }, select: { timezone: true } });
    return {
      userId: thread.userId,
      workspaceId: thread.workspaceId,
      timezone,
      now: new Date(),
      searchMemory: (query, range) => this.memory.search({ userId: thread.userId, ...range }, query),
    };
  }

  private async history(db: Tx | typeof prisma, threadId: string) {
    const rows = await db.assistantMessage.findMany({ where: { threadId }, orderBy: { seq: "asc" }, select: { content: true } });
    return rows.map((row) => row.content as LlmMessage);
  }

  private async nextSeq(tx: Tx, threadId: string) {
    const last = await tx.assistantMessage.findFirst({ where: { threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
    return (last?.seq ?? 0) + 1;
  }

  private async lockThread(tx: Tx, threadId: string) {
    await tx.$queryRaw`SELECT "id" FROM "AssistantThread" WHERE "id" = ${threadId} FOR UPDATE`;
    return tx.assistantThread.findUnique({ where: { id: threadId } });
  }

  private async lockOwn(tx: Tx, member: WorkspaceMember, threadId: string) {
    const thread = await this.lockThread(tx, threadId);
    if (!thread || thread.userId !== member.userId || thread.workspaceId !== member.workspaceId) {
      throw new ApiError(ErrorCode.NOT_FOUND, "Conversation not found.");
    }
    return thread;
  }

  /** The conversation for the screen: what each side said, each tool step, and the changes waiting for a decision. */
  async get(member: WorkspaceMember, threadId: string) {
    const thread = await prisma.assistantThread.findFirst({
      where: { id: threadId, userId: member.userId, workspaceId: member.workspaceId },
      include: {
        messages: {
          orderBy: { seq: "asc" },
          include: { toolCalls: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, aiUsage: { select: { credits: true } } },
        },
      },
    });
    if (!thread) throw new ApiError(ErrorCode.NOT_FOUND, "Conversation not found.");

    const items = thread.messages.flatMap((m) => [
      ...(m.kind === "USER" || (m.kind === "ASSISTANT" && m.text) ? [{ type: m.kind === "USER" ? "user" : "assistant", id: m.id, text: m.text, createdAt: m.createdAt }] : []),
      ...m.toolCalls.map(toolStep),
    ]);
    return {
      id: thread.id,
      title: thread.title,
      status: thread.status,
      stopCode: thread.stopCode,
      credits: thread.messages.reduce((sum, m) => sum + (m.aiUsage?.credits ?? 0), 0),
      items,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  }
}

/** A tool step without the raw output (a whole event list): a count for reads, the change itself for create_event. */
function toolStep(call: AssistantToolCall) {
  const output = (call.output ?? {}) as Record<string, unknown>;
  const count = (key: string) => (Array.isArray(output[key]) ? (output[key] as unknown[]).length : null);
  return {
    type: "tool" as const,
    id: call.id,
    name: call.name,
    status: call.status,
    count: count("events") ?? count("freeRanges") ?? count("calendars") ?? count("members") ?? count("results"),
    /** search_memory: where each hit came from, for the "근거" list under the answer */
    sources: Array.isArray(output.results)
      ? (output.results as Array<{ event: string; date: string; file?: string }>).map((r) => ({ event: r.event, date: r.date, file: r.file ?? null }))
      : null,
    preview: call.preview,
    error: typeof output.error === "string" ? output.error : null,
    eventId: typeof output.eventId === "string" ? output.eventId : null,
    createdAt: call.createdAt,
  };
}
