import { isDeepStrictEqual } from "util";

import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import { type Calendar, type CalendarRole, Prisma, prisma, type TripPlan, type WorkspaceMember } from "@plandit/database/prisma";
import {
  TRIP_MAX_DAYS,
  type TripDraft,
  tripDraftSchema,
  type TripInput,
  tripInputSchema,
  type tripPlanUpdateSchema,
} from "@plandit/shared/trips";
import type { z } from "zod";

import { AiUsageService } from "../ai/ai-usage.service";
import { LLM_CLIENT, type LlmClient } from "../ai/llm-client";
import { MockLlmAdapter } from "../ai/mock-llm.adapter";
import { ApiError, ErrorCode } from "../common/api-error";
import { type PageQuery, pageArgs, toPage } from "../common/pagination";
import { draftProblems, draftToEvents, parseDraft, sortDraft } from "./trip-draft";
import { buildTripRequest, buildTripRevisionRequest, isTripRequest, isTripRevision, largestTripInput, mockTripReply, mockTripRevision } from "./trip-prompt";
import { TripPlanQueue } from "./trip-plan.queue";

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 15_000 };
const WRITABLE: CalendarRole[] = ["OWNER", "ADMIN", "EDITOR"];
const MANAGING: CalendarRole[] = ["OWNER", "ADMIN"];

const sameIds = (a: string[], b: string[]) => isDeepStrictEqual([...a].sort(), [...b].sort());

/**
 * AI travel itineraries (PLANDIT-26): form → reserve credits + GENERATING (one transaction) → worker asks the model →
 * READY draft the user edits → apply creates the events (and gives attendees calendar access) in one transaction.
 * A plan is visible only to the person who made it.
 */
@Injectable()
export class TripPlanService implements OnModuleInit {
  constructor(
    private readonly usages: AiUsageService,
    private readonly queue: TripPlanQueue,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  onModuleInit() {
    // Whatever fails the usage (model error, bad reply, the stale sweep) fails the plan in the same refund transaction.
    this.usages.onFeatureFailure("TRIP_PLANNER", async (tx, usage) => {
      await tx.tripPlan.updateMany({ where: { aiUsageId: usage.id, status: "GENERATING" }, data: { status: "FAILED", failureCode: usage.failureCode } });
      // A revision's call failing leaves the plan's draft as it was; only the revision is closed.
      await tx.tripPlanRevision.updateMany({
        where: { aiUsageId: usage.id, status: "PENDING" },
        data: { status: "FAILED", failureCode: usage.failureCode, decidedAt: new Date() },
      });
    });
    if (this.llm instanceof MockLlmAdapter) {
      this.llm.respondTo(isTripRequest, mockTripReply);
      this.llm.respondTo(isTripRevision, mockTripRevision);
    }
  }

  /** What the form needs: who can come along, and the most credits a trip of each length can reserve. */
  async options(member: WorkspaceMember, calendarId: string) {
    const { calendar, canAddMembers } = await this.calendarFor(prisma, member, calendarId);
    const attendeesAllowed = calendar.type === "SHARED";
    const [members, onCalendar, account] = await Promise.all([
      attendeesAllowed
        ? prisma.workspaceMember.findMany({
            where: { workspaceId: member.workspaceId, userId: { not: member.userId } },
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: "asc" },
            take: 200,
          })
        : [],
      prisma.calendarMember.findMany({ where: { calendarId }, select: { userId: true } }),
      prisma.creditAccount.findUnique({ where: { workspaceId: member.workspaceId }, select: { balance: true } }),
    ]);
    const onCalendarIds = new Set(onCalendar.map((m) => m.userId));
    return {
      calendar: { id: calendar.id, name: calendar.name, type: calendar.type, timezone: calendar.timezone },
      attendeesAllowed,
      canAddMembers,
      members: members.map(({ user }) => ({
        id: user.id,
        name: user.name ?? user.email,
        email: user.email,
        onCalendar: onCalendarIds.has(user.id),
        selectable: onCalendarIds.has(user.id) || canAddMembers,
      })),
      maxCredits: Object.fromEntries(
        Array.from({ length: TRIP_MAX_DAYS }, (_, i) => [i + 1, this.usages.estimate(buildTripRequest(largestTripInput(i + 1)))]),
      ),
      balance: Number(account?.balance ?? 0),
    };
  }

  /**
   * Reserves credits and records the plan as GENERATING in one transaction, then queues the model call.
   * The same Idempotency-Key returns the same plan (and re-queues it if it is still waiting); nothing is charged twice.
   */
  async create(member: WorkspaceMember, requestKey: string, input: TripInput) {
    const key = { createdById_requestKey: { createdById: member.userId, requestKey } };
    const existing = await prisma.tripPlan.findUnique({ where: key });
    if (existing) return this.replay(member, existing, input);

    const { calendar, canAddMembers } = await this.calendarFor(prisma, member, input.calendarId);
    await this.attendeesFor(prisma, member, calendar, canAddMembers, input.attendeeUserIds);

    let plan: TripPlan;
    try {
      plan = await prisma.$transaction(async (tx) => {
        const usage = await this.usages.reserve(
          { workspaceId: member.workspaceId, userId: member.userId, feature: "TRIP_PLANNER", request: buildTripRequest(input) },
          tx,
        );
        return tx.tripPlan.create({
          data: { workspaceId: member.workspaceId, calendarId: calendar.id, createdById: member.userId, requestKey, input, aiUsageId: usage.id },
        });
      }, TX);
    } catch (error) {
      // The same key raced us: the other request's plan (and its single reservation) is the answer.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.replay(member, await prisma.tripPlan.findUniqueOrThrow({ where: key }), input);
      }
      throw error;
    }
    await this.queue.enqueueGenerate(plan.id);
    return this.get(member, plan.id);
  }

  private async replay(member: WorkspaceMember, plan: TripPlan, input: TripInput) {
    if (plan.workspaceId !== member.workspaceId || !isDeepStrictEqual(tripInputSchema.parse(plan.input), input)) {
      throw new ApiError(ErrorCode.IDEMPOTENCY_CONFLICT, "Idempotency-Key was already used for a different trip.");
    }
    if (plan.status === "GENERATING") await this.queue.enqueueGenerate(plan.id); // same job id: a no-op if it is queued
    return this.get(member, plan.id);
  }

  /** Worker: ask the model for a GENERATING plan. The draft and the credit settlement commit together. */
  async generate(tripPlanId: string) {
    const plan = await prisma.tripPlan.findUnique({ where: { id: tripPlanId } });
    if (!plan || plan.status !== "GENERATING") return "SKIPPED";
    const input = tripInputSchema.parse(plan.input);
    const outcome = await this.usages.execute(plan.aiUsageId, buildTripRequest(input), {
      parse: (result) => parseDraft(result.text, input),
      onSuccess: async (tx, draft) => {
        await tx.tripPlan.updateMany({ where: { id: plan.id, status: "GENERATING" }, data: { status: "READY", draft } });
      },
    });
    return outcome.status;
  }

  async get(member: WorkspaceMember, tripPlanId: string) {
    const plan = await prisma.tripPlan.findFirst({
      where: { id: tripPlanId, createdById: member.userId, workspaceId: member.workspaceId },
      include: {
        calendar: { select: { id: true, name: true, color: true, timezone: true, type: true } },
        aiUsage: { select: { estimatedCredits: true, credits: true, status: true } },
        _count: { select: { events: true } },
        revisions: { orderBy: { createdAt: "desc" }, take: 20, include: { aiUsage: { select: { estimatedCredits: true, credits: true } } } },
      },
    });
    if (!plan) throw new ApiError(ErrorCode.NOT_FOUND, "Trip plan not found.");

    const input = tripInputSchema.parse(plan.input);
    const [people, onCalendar] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { workspaceId: plan.workspaceId, userId: { in: input.attendeeUserIds } },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.calendarMember.findMany({ where: { calendarId: plan.calendarId, userId: { in: input.attendeeUserIds } }, select: { userId: true } }),
    ]);
    const attendees = input.attendeeUserIds.map((id) => {
      const person = people.find((p) => p.userId === id)?.user;
      return { id, name: person ? (person.name ?? person.email) : null, inWorkspace: Boolean(person), onCalendar: onCalendar.some((m) => m.userId === id) };
    });
    return {
      id: plan.id,
      status: plan.status,
      failureCode: plan.failureCode,
      calendar: plan.calendar,
      input,
      draft: plan.draft as TripDraft | null,
      estimatedCredits: plan.aiUsage.estimatedCredits,
      credits: plan.aiUsage.credits,
      attendees,
      /** Who would be added to the calendar as a viewer if the plan were applied now — the list apply() expects back */
      newCalendarMemberIds: attendees.filter((a) => a.inWorkspace && !a.onCalendar).map((a) => a.id).sort(),
      addedCalendarMemberIds: plan.addedCalendarMemberIds,
      eventCount: plan._count.events,
      /** "고쳐 줘" requests, oldest first (the latest 20). A PROPOSED one carries both drafts for the preview. */
      revisions: plan.revisions.reverse().map((r) => ({
        id: r.id,
        request: r.request,
        status: r.status,
        failureCode: r.failureCode,
        estimatedCredits: r.aiUsage.estimatedCredits,
        credits: r.aiUsage.credits,
        ...(r.status === "PROPOSED" ? { baseDraft: r.baseDraft as TripDraft, proposedDraft: r.proposedDraft as TripDraft } : {}),
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      })),
      createdAt: plan.createdAt,
      appliedAt: plan.appliedAt,
    };
  }

  /**
   * "둘째 날 오후는 쉬게 해줘" on a READY plan (PLANDIT-27): reserves credits and records the revision PENDING in one
   * transaction, then queues the model call. A proposal still waiting for a decision is discarded (the new request
   * supersedes it); one still being written is a 409. The same Idempotency-Key returns the same revision.
   */
  async requestRevision(member: WorkspaceMember, tripPlanId: string, requestKey: string, request: string) {
    const key = { tripPlanId_requestKey: { tripPlanId, requestKey } };
    const replay = async () => {
      const existing = await prisma.tripPlanRevision.findUniqueOrThrow({ where: key });
      if (existing.request !== request) throw new ApiError(ErrorCode.IDEMPOTENCY_CONFLICT, "Idempotency-Key was already used for a different request.");
      if (existing.status === "PENDING") await this.queue.enqueueRevise(existing.id);
      return this.get(member, tripPlanId);
    };
    await this.get(member, tripPlanId); // someone else's plan is a 404 before anything else
    if (await prisma.tripPlanRevision.findUnique({ where: key })) return replay();

    let revisionId: string | null;
    try {
      revisionId = await prisma.$transaction(async (tx) => {
        const plan = await this.lockOwn(tx, member, tripPlanId);
        // A double click waited for the lock behind the first: it is the same request, not a second one.
        if (await tx.tripPlanRevision.findUnique({ where: key })) return null;
        if (plan.status !== "READY") throw new ApiError(ErrorCode.CONFLICT, "Only a ready plan can be revised.");
        if (await tx.tripPlanRevision.count({ where: { tripPlanId, status: "PENDING" } })) {
          throw new ApiError(ErrorCode.CONFLICT, "The last request is still being worked on.");
        }
        await tx.tripPlanRevision.updateMany({ where: { tripPlanId, status: "PROPOSED" }, data: { status: "DISCARDED", decidedAt: new Date() } });
        const draft = tripDraftSchema.parse(plan.draft);
        const usage = await this.usages.reserve(
          {
            workspaceId: member.workspaceId,
            userId: member.userId,
            feature: "TRIP_PLANNER",
            request: buildTripRevisionRequest(tripInputSchema.parse(plan.input), draft, request),
          },
          tx,
        );
        const revision = await tx.tripPlanRevision.create({ data: { tripPlanId, requestKey, request, baseDraft: draft, aiUsageId: usage.id } });
        return revision.id;
      }, TX);
    } catch (error) {
      // The same key raced us: the other request's revision (and its single reservation) is the answer.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return replay();
      throw error;
    }
    if (!revisionId) return replay();
    await this.queue.enqueueRevise(revisionId);
    return this.get(member, tripPlanId);
  }

  /** Worker: the model's rewrite of a PENDING revision becomes its proposal, checked like a new draft. */
  async revise(revisionId: string) {
    const revision = await prisma.tripPlanRevision.findUnique({ where: { id: revisionId }, include: { tripPlan: { select: { input: true } } } });
    if (!revision || revision.status !== "PENDING") return "SKIPPED";
    const input = tripInputSchema.parse(revision.tripPlan.input);
    const request = buildTripRevisionRequest(input, tripDraftSchema.parse(revision.baseDraft), revision.request);
    const outcome = await this.usages.execute(revision.aiUsageId, request, {
      parse: (result) => parseDraft(result.text, input),
      onSuccess: async (tx, draft) => {
        await tx.tripPlanRevision.updateMany({ where: { id: revision.id, status: "PENDING" }, data: { status: "PROPOSED", proposedDraft: draft } });
      },
    });
    return outcome.status;
  }

  /**
   * Accepts (the plan takes the proposed draft) or discards a proposal, once: a repeated click is fine, the opposite
   * decision afterwards is a 409. Accepting needs the plan to still hold the draft the model was given - edited since
   * means TRIP_DRAFT_CHANGED, so nothing done by hand is silently overwritten.
   */
  async decideRevision(member: WorkspaceMember, tripPlanId: string, revisionId: string, accept: boolean) {
    await prisma.$transaction(async (tx) => {
      const plan = await this.lockOwn(tx, member, tripPlanId);
      const revision = await tx.tripPlanRevision.findFirst({ where: { id: revisionId, tripPlanId } });
      if (!revision) throw new ApiError(ErrorCode.NOT_FOUND, "Revision not found.");
      if (revision.status === (accept ? "ACCEPTED" : "DISCARDED")) return;
      if (revision.status !== "PROPOSED") throw new ApiError(ErrorCode.CONFLICT, "This revision is not waiting for a decision.");
      if (accept) {
        if (plan.status !== "READY") throw new ApiError(ErrorCode.CONFLICT, "Only a ready plan can change.");
        if (!isDeepStrictEqual(plan.draft, revision.baseDraft)) {
          throw new ApiError(ErrorCode.TRIP_DRAFT_CHANGED, "The draft changed after this revision was requested.");
        }
        await tx.tripPlan.update({ where: { id: plan.id }, data: { draft: revision.proposedDraft as Prisma.InputJsonValue } });
      }
      await tx.tripPlanRevision.update({ where: { id: revision.id }, data: { status: accept ? "ACCEPTED" : "DISCARDED", decidedAt: new Date() } });
    }, TX);
    return this.get(member, tripPlanId);
  }

  /** The requester's own plans in this workspace, newest first. */
  async list(member: WorkspaceMember, page: PageQuery) {
    const rows = await prisma.tripPlan.findMany({
      where: { workspaceId: member.workspaceId, createdById: member.userId },
      ...pageArgs(page),
      select: { id: true, status: true, failureCode: true, calendarId: true, input: true, createdAt: true, appliedAt: true },
    });
    const { items, nextCursor } = toPage(rows, page.limit, (row) => row.id);
    return {
      items: items.map(({ input, ...row }) => {
        const { destination, startDate, endDate } = tripInputSchema.parse(input);
        return { ...row, destination, startDate, endDate };
      }),
      nextCursor,
    };
  }

  /** Replace days (drop or change items) and/or who goes, while the plan is READY. */
  async update(member: WorkspaceMember, tripPlanId: string, update: z.infer<typeof tripPlanUpdateSchema>) {
    await prisma.$transaction(async (tx) => {
      const plan = await this.lockOwn(tx, member, tripPlanId);
      if (plan.status !== "READY") throw new ApiError(ErrorCode.CONFLICT, "Only a ready plan can be changed.");
      const input = tripInputSchema.parse(plan.input);
      let draft = tripDraftSchema.parse(plan.draft);

      if (update.days) {
        draft = sortDraft({ ...draft, days: update.days });
        const problems = draftProblems(draft, input);
        if (problems.length) throw new ApiError(ErrorCode.VALIDATION_FAILED, "Invalid trip days.", problems);
      }
      if (update.attendeeUserIds) {
        const { calendar, canAddMembers } = await this.calendarFor(tx, member, plan.calendarId);
        await this.attendeesFor(tx, member, calendar, canAddMembers, update.attendeeUserIds);
      }
      await tx.tripPlan.update({
        where: { id: plan.id },
        data: { draft, input: update.attendeeUserIds ? { ...input, attendeeUserIds: update.attendeeUserIds } : input },
      });
    }, TX);
    return this.get(member, tripPlanId);
  }

  /**
   * Creates the events in one transaction. Permissions and attendees are checked again (they may have changed since
   * the draft was made); attendees not on the calendar become VIEWERs only if the caller confirmed exactly that list.
   * Applying twice, or twice at once, creates the events once.
   */
  async apply(member: WorkspaceMember, tripPlanId: string, confirmedNewMembers: string[]) {
    await prisma.$transaction(async (tx) => {
      const plan = await this.lockOwn(tx, member, tripPlanId);
      if (plan.status === "APPLIED") return; // a retry or the second of two clicks: report what the first one did
      if (plan.status !== "READY") throw new ApiError(ErrorCode.CONFLICT, "Only a ready plan can be applied.");
      const input = tripInputSchema.parse(plan.input);
      const draft = tripDraftSchema.parse(plan.draft);

      const { calendar, canAddMembers } = await this.calendarFor(tx, member, plan.calendarId);
      const { people, newCalendarMemberIds } = await this.attendeesFor(tx, member, calendar, canAddMembers, input.attendeeUserIds);
      if (!sameIds(confirmedNewMembers, newCalendarMemberIds)) {
        throw new ApiError(ErrorCode.CALENDAR_MEMBERS_CHANGED, "The people to add to the calendar changed.", { newCalendarMemberIds });
      }

      // Only people not on the calendar yet; an existing member keeps their role, even one who joined a moment ago.
      if (newCalendarMemberIds.length) {
        await tx.calendarMember.createMany({
          data: newCalendarMemberIds.map((userId) => ({ calendarId: calendar.id, userId, role: "VIEWER" as const })),
          skipDuplicates: true,
        });
      }
      const events = await tx.event.createManyAndReturn({
        data: draftToEvents(draft, calendar.timezone).map((event) => ({
          ...event,
          calendarId: calendar.id,
          createdById: member.userId,
          visibility: "CALENDAR" as const,
          tripPlanId: plan.id,
        })),
        select: { id: true },
      });
      if (people.length) {
        await tx.eventAttendee.createMany({
          data: events.flatMap((event) => people.map((person) => ({ eventId: event.id, userId: person.id, email: person.email, name: person.name }))),
        });
      }
      await tx.tripPlan.update({
        where: { id: plan.id },
        data: { status: "APPLIED", appliedAt: new Date(), addedCalendarMemberIds: newCalendarMemberIds },
      });
    }, TX);
    return this.get(member, tripPlanId);
  }

  /** "되돌리기": deletes the events this plan made and returns it to READY. Calendar access given on apply stays. */
  async undo(member: WorkspaceMember, tripPlanId: string) {
    return prisma.$transaction(async (tx) => {
      const plan = await this.lockOwn(tx, member, tripPlanId);
      if (plan.status !== "APPLIED") throw new ApiError(ErrorCode.CONFLICT, "This plan has no events to remove.");
      await this.calendarFor(tx, member, plan.calendarId);
      const { count } = await tx.event.deleteMany({ where: { tripPlanId: plan.id } });
      await tx.tripPlan.update({ where: { id: plan.id }, data: { status: "READY", appliedAt: null } });
      return { deleted: count };
    }, TX);
  }

  private async lockOwn(tx: Tx, member: WorkspaceMember, tripPlanId: string) {
    await tx.$queryRaw`SELECT "id" FROM "TripPlan" WHERE "id" = ${tripPlanId} FOR UPDATE`;
    const plan = await tx.tripPlan.findFirst({ where: { id: tripPlanId, createdById: member.userId, workspaceId: member.workspaceId } });
    if (!plan) throw new ApiError(ErrorCode.NOT_FOUND, "Trip plan not found.");
    return plan;
  }

  /** The target calendar: 404 unless it is in this workspace and the user is on it; 403 unless they can add events. */
  private async calendarFor(db: Tx, member: WorkspaceMember, calendarId: string) {
    const calendar = await db.calendar.findFirst({
      where: { id: calendarId, workspaceId: member.workspaceId },
      include: { members: { where: { userId: member.userId }, select: { role: true } } },
    });
    const role = calendar?.members[0]?.role;
    if (!calendar || !role) throw new ApiError(ErrorCode.NOT_FOUND, "Calendar not found.");
    if (!WRITABLE.includes(role) || calendar.type === "SUBSCRIBED") {
      throw new ApiError(ErrorCode.FORBIDDEN, "You cannot add events to this calendar.");
    }
    return { calendar, canAddMembers: MANAGING.includes(role) && calendar.type === "SHARED" };
  }

  /**
   * Attendees must be other members of this workspace, on a shared calendar (400 ATTENDEE_NOT_ELIGIBLE otherwise).
   * Those not on the calendar yet need a calendar OWNER/ADMIN to bring them (403). Returns them and who they are.
   */
  private async attendeesFor(db: Tx, member: WorkspaceMember, calendar: Calendar, canAddMembers: boolean, attendeeUserIds: string[]) {
    if (!attendeeUserIds.length) return { people: [], newCalendarMemberIds: [] };
    if (calendar.type !== "SHARED") {
      throw new ApiError(ErrorCode.ATTENDEE_NOT_ELIGIBLE, "A personal calendar has no attendees.", { userIds: attendeeUserIds });
    }
    const members = await db.workspaceMember.findMany({
      where: { workspaceId: member.workspaceId, userId: { in: attendeeUserIds } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const ineligible = attendeeUserIds.filter((id) => id === member.userId || !members.some((m) => m.userId === id));
    if (ineligible.length) {
      throw new ApiError(ErrorCode.ATTENDEE_NOT_ELIGIBLE, "Attendees must be other members of this workspace.", { userIds: ineligible });
    }

    const onCalendar = await db.calendarMember.findMany({
      where: { calendarId: calendar.id, userId: { in: attendeeUserIds } },
      select: { userId: true },
    });
    const newCalendarMemberIds = attendeeUserIds.filter((id) => !onCalendar.some((m) => m.userId === id)).sort();
    if (newCalendarMemberIds.length && !canAddMembers) {
      throw new ApiError(ErrorCode.FORBIDDEN, "Only calendar owners and admins can bring people who are not on the calendar.", {
        userIds: newCalendarMemberIds,
      });
    }
    const people = attendeeUserIds.map((id) => members.find((m) => m.userId === id)!.user);
    return { people, newCalendarMemberIds };
  }
}
