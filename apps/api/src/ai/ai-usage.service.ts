import { Inject, Injectable, Logger } from "@nestjs/common";

import { type AiFeature, type AiUsage, type AiUsageStatus, Prisma, prisma, type WorkspaceMember } from "@plandit/database/prisma";
import {
  AI_MODEL_RATES,
  type AttemptUsage,
  ceilingRates,
  creditsForAttempts,
  estimateInputTokens,
  reserveCredits,
  type TokenRates,
} from "@plandit/shared/ai";

import { AuditService } from "../audit/audit.service";
import { ApiError, ErrorCode } from "../common/api-error";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";
import { monthIn } from "../common/zoned-time";
import { LedgerService } from "../credit/ledger.service";
import { aiCallDuration, aiCalls, aiTokens } from "../metrics/metrics";
import { LLM_CLIENT, LlmError, type LlmClient, type LlmRequest, type LlmResult, MAX_OUTPUT_TOKENS, requestText } from "./llm-client";

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 10_000 };

export type ReserveInput = { workspaceId: string; userId: string; feature: AiFeature; request: LlmRequest };

export type ExecuteHooks<T> = {
  /** Turns the reply into the feature's result. Throwing marks the call INVALID_OUTPUT, which is refunded. */
  parse: (result: LlmResult) => T;
  /** Runs inside the settlement transaction: the feature's own state commits together with the charge, or neither does. */
  onSuccess?: (tx: Tx, output: T, usage: AiUsage) => Promise<void>;
  /** Runs inside the refund transaction. */
  onFailure?: (tx: Tx, code: string, usage: AiUsage) => Promise<void>;
};

export type ExecuteOutcome<T> =
  | { status: "SUCCEEDED"; output: T; usage: AiUsage }
  | { status: "FAILED"; code: string; usage: AiUsage }
  /** Another execute() owns this usage, or it already finished: nothing was called or changed. */
  | { status: "SKIPPED"; usage: AiUsage };

export type FailOptions = {
  tx?: Tx;
  attempts?: AttemptUsage[];
  model?: string;
  latencyMs?: number;
  onFailure?: (tx: Tx, code: string, usage: AiUsage) => Promise<void>;
};

const minutes = (n: number) => n * 60_000;

/** The monthly AI limit counts calendar months on this clock (like the daily ledger check). */
const LIMIT_TIMEZONE = "Asia/Seoul";

function totals(attempts: AttemptUsage[]) {
  return attempts.reduce(
    (sum, a) => ({
      inputTokens: sum.inputTokens + a.inputTokens,
      outputTokens: sum.outputTokens + a.outputTokens,
      cacheReadInputTokens: sum.cacheReadInputTokens + a.cacheReadInputTokens,
      cacheWriteInputTokens: sum.cacheWriteInputTokens + a.cacheWriteInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
  );
}

export function toAiUsageDto(usage: AiUsage & { user?: { id: string; name: string | null } }) {
  const { debitLedgerId, adjustLedgerId, refundLedgerId, workspaceId, userId, ...rest } = usage;
  return {
    ...rest,
    debitLedgerId: debitLedgerId?.toString() ?? null,
    adjustLedgerId: adjustLedgerId?.toString() ?? null,
    refundLedgerId: refundLedgerId?.toString() ?? null,
  };
}

/**
 * Metering for every LLM call: reserve (DEBIT) → record CALLING → call → settle (ADJUST back the unused part) or fail
 * (REFUND everything). Credits only move through LedgerService, keyed "AI_USAGE:{id}:{type}", so any retry is a replay.
 * Features call this service, never the LlmClient directly.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  /** Priced once at boot: a configured model without credit rates stops the app here. */
  private readonly ceiling: TokenRates;
  private readonly featureFailures = new Map<AiFeature, (tx: Tx, usage: AiUsage) => Promise<void>>();

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {
    this.ceiling = ceilingRates(llm.servingModels);
  }

  /**
   * A feature whose own row follows its usage (a trip plan's GENERATING → FAILED) registers here, so every way a
   * usage fails — including the stale sweep, which knows nothing about features — updates it in the refund transaction.
   */
  onFeatureFailure(feature: AiFeature, handler: (tx: Tx, usage: AiUsage) => Promise<void>) {
    this.featureFailures.set(feature, handler);
  }

  private get staleMs() {
    return Number(process.env.AI_USAGE_STALE_MS ?? minutes(30));
  }

  /** Credits a request would reserve. Shown to the user before they confirm (PLANDIT-26). */
  estimate(request: LlmRequest) {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > MAX_OUTPUT_TOKENS) {
      throw new Error(`maxOutputTokens must be 1-${MAX_OUTPUT_TOKENS}.`); // a feature bug, not a client error
    }
    return reserveCredits(estimateInputTokens(requestText(request)), request.maxOutputTokens, this.ceiling);
  }

  /**
   * Debits the estimate and records the usage as RESERVED, in one transaction (the caller's, when `tx` is given, so a
   * feature row and its reservation commit together). Not enough credits → INSUFFICIENT_CREDITS, over the workspace's
   * monthly AI limit → AI_MONTHLY_LIMIT; either way no row.
   */
  reserve(input: ReserveInput, tx?: Tx): Promise<AiUsage> {
    const estimatedCredits = this.estimate(input.request);
    const run = async (t: Tx) => {
      // Locked first: reservations for one workspace queue here, so two at once cannot both slip under the limit.
      const [account] = await t.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CreditAccount" WHERE "workspaceId" = ${input.workspaceId} FOR UPDATE`;
      if (!account) throw new ApiError(ErrorCode.NOT_FOUND, "Credit account not found.");
      await this.assertWithinLimit(t, input.workspaceId, estimatedCredits);
      const accountId = account.id;
      const usage = await t.aiUsage.create({
        data: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          feature: input.feature,
          provider: this.llm.provider,
          maxOutputTokens: input.request.maxOutputTokens,
          estimatedCredits,
        },
      });
      const { entry } = await this.ledger.append(
        {
          accountId,
          type: "DEBIT",
          amount: -estimatedCredits,
          refType: "AI_USAGE",
          refId: usage.id,
          idempotencyKey: `AI_USAGE:${usage.id}:DEBIT`,
        },
        t,
      );
      return t.aiUsage.update({ where: { id: usage.id }, data: { debitLedgerId: entry.id } });
    };
    return tx ? run(tx) : prisma.$transaction(run, TX);
  }

  /**
   * This month's AI use: what settled calls charged, plus what calls still in flight reserved (their estimate, so
   * concurrent reservations count before they settle). Failed calls charge 0.
   */
  private async usedSince(db: Tx | typeof prisma, workspaceId: string, since: Date) {
    const [row] = await db.$queryRaw<Array<{ used: bigint | null }>>`
      SELECT SUM(CASE WHEN "status" IN ('RESERVED', 'CALLING') THEN "estimatedCredits" ELSE "credits" END) AS "used"
      FROM "AiUsage" WHERE "workspaceId" = ${workspaceId} AND "createdAt" >= ${since}`;
    return Number(row?.used ?? 0);
  }

  private async assertWithinLimit(t: Tx, workspaceId: string, requested: number) {
    const { aiMonthlyCreditLimit: limit } = await t.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMonthlyCreditLimit: true } });
    if (limit === null) return;
    const month = monthIn(new Date(), LIMIT_TIMEZONE);
    const used = await this.usedSince(t, workspaceId, month.start);
    if (used + requested > limit) {
      throw new ApiError(ErrorCode.AI_MONTHLY_LIMIT, "This call would go over the workspace's monthly AI credit limit.", { limit, used, requested, resetsAt: month.end });
    }
  }

  /** The workspace's monthly AI limit and where this month stands. */
  async limitOf(workspaceId: string) {
    const { aiMonthlyCreditLimit: limit } = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiMonthlyCreditLimit: true } });
    const month = monthIn(new Date(), LIMIT_TIMEZONE);
    const used = await this.usedSince(prisma, workspaceId, month.start);
    return { monthlyCreditLimit: limit, used, remaining: limit === null ? null : Math.max(0, limit - used), periodStart: month.start, resetsAt: month.end };
  }

  /** Sets or removes (null) the limit. A real change is audited in its own transaction; the same value again is not. */
  async setLimit(actor: WorkspaceMember, limit: number | null) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${actor.workspaceId} FOR UPDATE`;
      const before = await tx.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId }, select: { aiMonthlyCreditLimit: true } });
      if (before.aiMonthlyCreditLimit === limit) return;
      await tx.workspace.update({ where: { id: actor.workspaceId }, data: { aiMonthlyCreditLimit: limit } });
      await this.audit.record(
        {
          action: "workspace.ai_limit_changed",
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          targetType: "workspace",
          targetId: actor.workspaceId,
          payload: { from: before.aiMonthlyCreditLimit, to: limit },
        },
        tx,
      );
    }, TX);
    return this.limitOf(actor.workspaceId);
  }

  /** reserve() + execute(), for callers that wait for the answer. */
  async run<T>(input: ReserveInput, hooks: ExecuteHooks<T>): Promise<ExecuteOutcome<T>> {
    const usage = await this.reserve(input);
    return this.execute(usage.id, input.request, hooks);
  }

  /**
   * Calls the model for a RESERVED usage. CALLING is written first with a conditional update, so two concurrent or
   * repeated calls reach the model once. The call itself runs outside any transaction.
   */
  async execute<T>(usageId: string, request: LlmRequest, hooks: ExecuteHooks<T>): Promise<ExecuteOutcome<T>> {
    const reserved = await prisma.aiUsage.findUniqueOrThrow({ where: { id: usageId } });
    if (reserved.status !== "RESERVED") return { status: "SKIPPED", usage: reserved };
    if (request.maxOutputTokens > reserved.maxOutputTokens) {
      throw new Error(`Request asks for ${request.maxOutputTokens} output tokens; ${reserved.maxOutputTokens} were reserved.`);
    }

    const claimed = await prisma.aiUsage.updateMany({
      where: { id: usageId, status: "RESERVED" },
      data: { status: "CALLING", startedAt: new Date() },
    });
    if (!claimed.count) return { status: "SKIPPED", usage: await prisma.aiUsage.findUniqueOrThrow({ where: { id: usageId } }) };

    const started = Date.now();
    let result: LlmResult;
    try {
      result = await this.llm.complete(request);
    } catch (error) {
      const code = error instanceof LlmError ? error.code : "LLM_ERROR";
      this.logger.warn({ usageId, code, err: error }, "LLM call failed");
      return this.failed<T>(usageId, code, { latencyMs: this.observe(started), onFailure: hooks.onFailure });
    }
    const latencyMs = this.observe(started);
    this.countTokens(result.attempts);

    const failWith = (code: string) =>
      this.failed<T>(usageId, code, { attempts: result.attempts, model: result.model, latencyMs, onFailure: hooks.onFailure });
    if (result.stopReason === "refusal") return failWith("LLM_REFUSED");
    if (result.stopReason === "max_tokens") return failWith("LLM_TRUNCATED");

    let output: T;
    try {
      output = hooks.parse(result);
    } catch (error) {
      // Only the error type: parse messages can quote the reply, which may contain the user's own content.
      this.logger.warn({ usageId, error: error instanceof Error ? error.name : typeof error }, "LLM reply did not parse");
      return failWith("INVALID_OUTPUT");
    }

    try {
      const outcome = await this.settle(usageId, result, latencyMs, output, hooks);
      if (outcome.status === "SUCCEEDED") aiCalls.inc({ provider: this.llm.provider, outcome: "SUCCEEDED" });
      return outcome;
    } catch (error) {
      // Settlement (or the feature's onSuccess) failed: refund instead. If this throws too, the row stays CALLING and
      // the stale sweep refunds it. If the settlement had in fact committed, report what the row says.
      this.logger.error({ usageId, err: error }, "AI usage settlement failed");
      const outcome = await failWith("INTERNAL");
      return outcome.usage.status === "SUCCEEDED" ? { status: "SUCCEEDED", output, usage: outcome.usage } : outcome;
    }
  }

  private settle<T>(usageId: string, result: LlmResult, latencyMs: number, output: T, hooks: ExecuteHooks<T>) {
    return prisma.$transaction(async (tx): Promise<ExecuteOutcome<T>> => {
      const usage = await this.lock(tx, usageId);
      if (usage.status !== "CALLING") {
        // Swept as stale while the model was still answering: that refund stands, nothing is charged.
        this.logger.warn({ usageId, status: usage.status }, "Late LLM reply for a usage that is no longer CALLING");
        return { status: "FAILED", code: usage.failureCode ?? "STALE", usage };
      }

      const actual = creditsForAttempts(result.attempts, this.ratesFor);
      const credits = Math.min(actual, usage.estimatedCredits);
      if (actual > usage.estimatedCredits) {
        this.logger.warn({ usageId, actual, reserved: usage.estimatedCredits }, "AI usage exceeded its reservation; charging the reservation");
      }

      const returned = usage.estimatedCredits - credits;
      const adjust = returned
        ? await this.ledger.append(
            {
              accountId: await this.accountIdOf(tx, usage.workspaceId),
              type: "ADJUST",
              amount: returned,
              refType: "AI_USAGE",
              refId: usage.id,
              idempotencyKey: `AI_USAGE:${usage.id}:ADJUST`,
            },
            tx,
          )
        : null;

      const settled = await tx.aiUsage.update({
        where: { id: usageId },
        data: {
          status: "SUCCEEDED",
          model: result.model,
          credits,
          ...totals(result.attempts),
          attempts: result.attempts,
          latencyMs,
          adjustLedgerId: adjust?.entry.id ?? null,
          finishedAt: new Date(),
        },
      });
      await hooks.onSuccess?.(tx, output, settled);
      return { status: "SUCCEEDED", output, usage: settled };
    }, TX);
  }

  /**
   * Refunds the whole reservation and marks the usage FAILED — unless it already finished, in which case nothing
   * changes (`refunded: false`). Tokens of a failed call are still recorded; the charge is 0.
   */
  fail(usageId: string, code: string, options: FailOptions = {}): Promise<{ usage: AiUsage; refunded: boolean }> {
    const run = async (tx: Tx) => {
      const usage = await this.lock(tx, usageId);
      if (usage.status === "SUCCEEDED" || usage.status === "FAILED") return { usage, refunded: false };

      const { entry } = await this.ledger.append(
        {
          accountId: await this.accountIdOf(tx, usage.workspaceId),
          type: "REFUND",
          amount: usage.estimatedCredits,
          refType: "AI_USAGE",
          refId: usage.id,
          idempotencyKey: `AI_USAGE:${usage.id}:REFUND`,
        },
        tx,
      );
      const attempts = options.attempts ?? [];
      const failed = await tx.aiUsage.update({
        where: { id: usageId },
        data: {
          status: "FAILED",
          failureCode: code,
          credits: 0,
          model: options.model ?? null,
          ...totals(attempts),
          ...(attempts.length ? { attempts } : {}),
          latencyMs: options.latencyMs ?? null,
          refundLedgerId: entry.id,
          finishedAt: new Date(),
        },
      });
      await this.featureFailures.get(failed.feature)?.(tx, failed);
      await options.onFailure?.(tx, code, failed);
      return { usage: failed, refunded: true };
    };
    return options.tx ? run(options.tx) : prisma.$transaction(run, TX);
  }

  private async failed<T>(usageId: string, code: string, options: FailOptions): Promise<ExecuteOutcome<T>> {
    const { usage, refunded } = await this.fail(usageId, code, options);
    if (refunded) aiCalls.inc({ provider: usage.provider, outcome: code });
    return { status: "FAILED", code: usage.failureCode ?? code, usage };
  }

  /**
   * Fails and refunds usages stuck longer than AI_USAGE_STALE_MS: RESERVED since creation (never called) or CALLING
   * since the call started (the process died mid-call, or the call outlived every timeout). Keep AI_USAGE_STALE_MS
   * above LLM_TIMEOUT_MS × (LLM_MAX_RETRIES + 1).
   */
  async reconcileStale(now = new Date(), minAgeMs = this.staleMs) {
    const cutoff = new Date(now.getTime() - minAgeMs);
    const due = await prisma.aiUsage.findMany({
      where: {
        OR: [
          { status: "RESERVED", createdAt: { lte: cutoff } },
          { status: "CALLING", startedAt: { lte: cutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true },
    });

    const summary = { checked: 0, refunded: 0, errors: 0 };
    for (const { id } of due) {
      summary.checked++;
      try {
        const { usage, refunded } = await this.fail(id, "STALE");
        if (refunded) {
          summary.refunded++;
          aiCalls.inc({ provider: usage.provider, outcome: "STALE" });
        }
      } catch (error) {
        summary.errors++;
        this.logger.error({ usageId: id, err: error }, "Stale AI usage refund failed");
      }
    }
    if (summary.checked) this.logger.log(summary, "Stale AI usage sweep finished");
    return summary;
  }

  /** Newest first by default. */
  async list(workspaceId: string, page: PageQuery, filter: { status?: AiUsageStatus; feature?: AiFeature }) {
    const rows = await prisma.aiUsage.findMany({
      where: { workspaceId, ...(filter.status ? { status: filter.status } : {}), ...(filter.feature ? { feature: filter.feature } : {}) },
      ...pageArgs(page),
      include: { user: { select: { id: true, name: true } } },
    });
    const { items, nextCursor } = toPage(rows, page.limit, (row) => row.id);
    return { items: items.map(toAiUsageDto), nextCursor };
  }

  private ratesFor = (model: string): TokenRates => {
    const rates = AI_MODEL_RATES[model];
    if (rates) return rates;
    this.logger.warn({ model }, "No credit rates for the serving model; using the dearest configured rates");
    return this.ceiling;
  };

  private observe(started: number) {
    const latencyMs = Date.now() - started;
    aiCallDuration.observe({ provider: this.llm.provider }, latencyMs / 1000);
    return latencyMs;
  }

  private countTokens(attempts: AttemptUsage[]) {
    for (const a of attempts) {
      aiTokens.inc({ model: a.model, kind: "input" }, a.inputTokens);
      aiTokens.inc({ model: a.model, kind: "output" }, a.outputTokens);
      aiTokens.inc({ model: a.model, kind: "cache_read" }, a.cacheReadInputTokens);
      aiTokens.inc({ model: a.model, kind: "cache_write" }, a.cacheWriteInputTokens);
    }
  }

  private async lock(tx: Tx, usageId: string) {
    await tx.$queryRaw`SELECT "id" FROM "AiUsage" WHERE "id" = ${usageId} FOR UPDATE`;
    return tx.aiUsage.findUniqueOrThrow({ where: { id: usageId } });
  }

  private async accountIdOf(tx: Tx, workspaceId: string) {
    const account = await tx.creditAccount.findUnique({ where: { workspaceId }, select: { id: true } });
    if (!account) throw new ApiError(ErrorCode.NOT_FOUND, "Credit account not found.");
    return account.id;
  }
}
