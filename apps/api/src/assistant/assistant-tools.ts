import { type CalendarRole, Prisma, prisma } from "@plandit/database/prisma";
import { z } from "zod";

import { toLlmJsonSchema, type LlmTool } from "../ai/llm-client";
import { toLocalIso } from "../common/zoned-time";
import { freeRanges, nextHalfHour } from "./free-slots";

type Db = Prisma.TransactionClient | typeof prisma;

/** Who the assistant acts for. Every tool sees exactly what this person could see or do through the API. */
export type ToolContext = { userId: string; workspaceId: string; timezone: string; now: Date };

/** Becomes the tool result with is_error: the model reads the message and can try again. */
export class ToolError extends Error {}

// Method signatures (not function properties) so a Tool<SomeInput> fits in the Tool<unknown> list.
export type Tool<I> = {
  name: string;
  description: string;
  input: z.ZodType<I>;
} & (
  | { write: false; run(ctx: ToolContext, input: I): Promise<unknown> }
  | {
      /** Runs only after the person approves */
      write: true;
      /** Validates and describes the change in names (the approval card). Throws ToolError when it cannot be done. */
      check(db: Db, ctx: ToolContext, input: I): Promise<Record<string, unknown>>;
      /** Inside the approval transaction; checks again first (things may have changed while waiting) */
      run(tx: Prisma.TransactionClient, ctx: ToolContext, input: I): Promise<unknown>;
    }
);

const WRITABLE: CalendarRole[] = ["OWNER", "ADMIN", "EDITOR"];
const MAX_EVENTS = 50;
const MAX_RANGES = 20;
const day = 86_400_000;

const datetime = z.iso.datetime({ offset: true, local: false }).describe("ISO 8601, 시간대 오프셋 포함 (예: 2026-10-08T14:00:00+09:00)");
const date = z.iso.date().describe("YYYY-MM-DD (사용자 시간대 기준 날짜)");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("HH:mm");

/** The same rule as GET /events: my PRIVATE events, plus CALENDAR/PUBLIC_LINK events of calendars I am on. */
const visibleTo = (userId: string): Prisma.EventWhereInput => ({
  OR: [
    { visibility: "PRIVATE", createdById: userId },
    { visibility: { in: ["CALENDAR", "PUBLIC_LINK"] }, calendar: { members: { some: { userId } } } },
  ],
});

const overlapping = (from: Date, to: Date): Prisma.EventWhereInput => ({ startsAt: { lt: to }, endsAt: { gt: from } });

const listCalendars: Tool<Record<string, never>> = {
  name: "list_calendars",
  description: "이 워크스페이스에서 사용자가 멤버인 캘린더와 사용자의 역할. 일정을 만들기 전에 어느 캘린더에 넣을지 고를 때 부른다(writable인 것만 가능).",
  input: z.object({}),
  write: false,
  async run(ctx) {
    const calendars = await prisma.calendar.findMany({
      where: { workspaceId: ctx.workspaceId, members: { some: { userId: ctx.userId } } },
      include: { members: { where: { userId: ctx.userId }, select: { role: true } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return {
      calendars: calendars.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        role: c.members[0].role,
        writable: WRITABLE.includes(c.members[0].role) && c.type !== "SUBSCRIBED",
        timezone: c.timezone,
      })),
    };
  },
};

const listMembers: Tool<Record<string, never>> = {
  name: "list_members",
  description: "이 워크스페이스의 멤버 이름과 userId. 사용자가 사람 이름을 말했을 때(\"민수랑 회의\") 참석자로 넣을 userId를 찾으려고 부른다.",
  input: z.object({}),
  write: false,
  async run(ctx) {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    // Names only: e-mail addresses are not needed to pick someone, so they are not sent to the model.
    return { members: members.map((m) => ({ userId: m.userId, name: m.user.name ?? "(이름 없음)", isMe: m.userId === ctx.userId })) };
  },
};

const listEventsInput = z
  .object({ from: datetime, to: datetime, calendarId: z.string().min(1).optional().describe("이 캘린더의 일정만") })
  .refine((i) => Date.parse(i.to) > Date.parse(i.from), { message: "to must be after from." })
  .refine((i) => Date.parse(i.to) - Date.parse(i.from) <= 31 * day, { message: "At most 31 days at a time." });

const listEvents: Tool<z.infer<typeof listEventsInput>> = {
  name: "list_events",
  description: `사용자가 볼 수 있는 일정(모든 캘린더) 중 기간과 겹치는 것. 일정 내용을 묻거나 약속이 있는지 확인할 때 부른다. 한 번에 최대 31일, ${MAX_EVENTS}개.`,
  input: listEventsInput,
  write: false,
  async run(ctx, input) {
    const events = await prisma.event.findMany({
      where: { AND: [visibleTo(ctx.userId), overlapping(new Date(input.from), new Date(input.to))], ...(input.calendarId ? { calendarId: input.calendarId } : {}) },
      include: { calendar: { select: { name: true } } },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      take: MAX_EVENTS + 1,
    });
    return {
      timezone: ctx.timezone,
      events: events.slice(0, MAX_EVENTS).map((e) => ({
        id: e.id,
        calendar: e.calendar.name,
        title: e.title,
        start: toLocalIso(e.startsAt, ctx.timezone),
        end: toLocalIso(e.endsAt, ctx.timezone),
        allDay: e.allDay,
        status: e.status,
        ...(e.location ? { location: e.location } : {}),
      })),
      truncated: events.length > MAX_EVENTS,
    };
  },
};

const findFreeSlotsInput = z
  .object({
    fromDate: date,
    toDate: date,
    durationMinutes: z.number().int().min(15).max(480).describe("필요한 길이(분)"),
    dayStart: clock.default("09:00").describe("하루 중 찾을 시작 시각(HH:mm), 기본 09:00"),
    dayEnd: clock.default("18:00").describe("하루 중 찾을 끝 시각(HH:mm), 기본 18:00"),
    includeWeekends: z.boolean().default(false).describe("주말도 찾을지, 기본 false"),
  })
  .refine((i) => i.toDate >= i.fromDate, { message: "toDate must not be before fromDate." })
  .refine((i) => Date.parse(i.toDate) - Date.parse(i.fromDate) < 14 * day, { message: "At most 14 days at a time." })
  .refine((i) => i.dayEnd > i.dayStart, { message: "dayEnd must be after dayStart." });

const findFreeSlots: Tool<z.infer<typeof findFreeSlotsInput>> = {
  name: "find_free_slots",
  description:
    "사용자가 볼 수 있는 일정을 피해서, 날짜 범위 안에서 durationMinutes 이상 비어 있는 시간대를 찾는다(사용자 시간대 기준, 지금 이후만). 회의·약속 시간을 정할 때 일정을 만들기 전에 부른다. 다른 사람의 개인 캘린더 일정은 보이지 않으므로, 결과는 '보이는 일정 기준'이라고 사용자에게 알려야 한다. 종일 일정은 바쁜 시간으로 치지 않고 allDayEvents로 따로 준다.",
  input: findFreeSlotsInput,
  write: false,
  async run(ctx, input) {
    const from = new Date(Date.parse(`${input.fromDate}T00:00:00Z`) - day); // a day either side covers any time zone
    const to = new Date(Date.parse(`${input.toDate}T00:00:00Z`) + 2 * day);
    const events = await prisma.event.findMany({
      where: { AND: [visibleTo(ctx.userId), overlapping(from, to)], status: { not: "CANCELLED" } },
      select: { title: true, startsAt: true, endsAt: true, allDay: true },
      orderBy: { startsAt: "asc" },
    });
    const ranges = freeRanges({
      ...input,
      timezone: ctx.timezone,
      minMinutes: input.durationMinutes,
      busy: events.filter((e) => !e.allDay).map((e) => ({ start: e.startsAt, end: e.endsAt })),
      notBefore: nextHalfHour(ctx.now),
    });
    return {
      timezone: ctx.timezone,
      basis: "요청한 사용자가 볼 수 있는 일정만 반영함. 다른 사람의 개인 일정은 알 수 없음",
      freeRanges: ranges.slice(0, MAX_RANGES).map((r) => ({ start: toLocalIso(r.start, ctx.timezone), end: toLocalIso(r.end, ctx.timezone) })),
      allDayEvents: events
        .filter((e) => e.allDay)
        .map((e) => ({ title: e.title, start: toLocalIso(e.startsAt, ctx.timezone), end: toLocalIso(e.endsAt, ctx.timezone) })),
    };
  },
};

const createEventInput = z
  .object({
    calendarId: z.string().min(1).describe("list_calendars에서 writable인 캘린더"),
    title: z.string().trim().min(1).max(120),
    startsAt: datetime,
    endsAt: datetime,
    location: z.string().trim().max(240).optional(),
    description: z.string().trim().max(2000).optional(),
    attendeeUserIds: z.array(z.string().min(1)).max(20).default([]).describe("참석자 userId(list_members). 공유 캘린더의 멤버만, 본인 제외"),
  })
  .refine((i) => Date.parse(i.endsAt) > Date.parse(i.startsAt), { message: "endsAt must be after startsAt." })
  .refine((i) => Date.parse(i.endsAt) - Date.parse(i.startsAt) <= day, { message: "An event can be at most 24 hours." })
  .refine((i) => new Set(i.attendeeUserIds).size === i.attendeeUserIds.length, { message: "Each attendee can appear only once." });
type CreateEventInput = z.infer<typeof createEventInput>;

/** Same permission as POST /events with a calendar: OWNER/ADMIN/EDITOR, in this workspace. Attendees must be on the calendar. */
async function checkCreate(db: Db, ctx: ToolContext, input: CreateEventInput) {
  const calendar = await db.calendar.findFirst({
    where: { id: input.calendarId, workspaceId: ctx.workspaceId },
    include: { members: { where: { userId: ctx.userId }, select: { role: true } } },
  });
  const role = calendar?.members[0]?.role;
  if (!calendar || !role) throw new ToolError("Calendar not found in this workspace.");
  if (!WRITABLE.includes(role) || calendar.type === "SUBSCRIBED") throw new ToolError("The user cannot add events to this calendar.");

  if (input.attendeeUserIds.length && calendar.type !== "SHARED") throw new ToolError("A personal calendar has no attendees.");
  const onCalendar = await db.calendarMember.findMany({
    where: { calendarId: calendar.id, userId: { in: input.attendeeUserIds } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  const missing = input.attendeeUserIds.filter((id) => id === ctx.userId || !onCalendar.some((m) => m.userId === id));
  if (missing.length) throw new ToolError(`Attendees must be other members of this calendar: ${missing.join(", ")}`);
  return { calendar, people: input.attendeeUserIds.map((id) => onCalendar.find((m) => m.userId === id)!.user) };
}

const createEvent: Tool<CreateEventInput> = {
  name: "create_event",
  description:
    "캘린더에 일정을 하나 만든다. 사용자 승인 후에만 실행되고, 거절되면 그 사실이 결과로 돌아온다. 시간이 정해지지 않았으면 먼저 find_free_slots로 찾고, 캘린더는 list_calendars에서 writable인 것을 쓴다.",
  input: createEventInput,
  write: true,
  async check(db, ctx, input) {
    const { calendar, people } = await checkCreate(db, ctx, input);
    return {
      calendar: calendar.name,
      title: input.title,
      start: toLocalIso(new Date(input.startsAt), ctx.timezone),
      end: toLocalIso(new Date(input.endsAt), ctx.timezone),
      location: input.location ?? null,
      attendees: people.map((p) => p.name ?? p.email),
    };
  },
  async run(tx, ctx, input) {
    const { calendar, people } = await checkCreate(tx, ctx, input);
    const event = await tx.event.create({
      data: {
        calendarId: calendar.id,
        createdById: ctx.userId,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        visibility: calendar.type === "PERSONAL" ? "PRIVATE" : "CALENDAR",
        attendees: { create: people.map((p) => ({ userId: p.id, email: p.email, name: p.name })) },
      },
    });
    return { eventId: event.id, calendar: calendar.name, title: event.title, start: toLocalIso(event.startsAt, ctx.timezone), end: toLocalIso(event.endsAt, ctx.timezone) };
  },
};

/** Fixed order: the list is part of the cached, thinking-bound prompt prefix, so it must not change between turns. */
export const ASSISTANT_TOOLS: Tool<unknown>[] = [listCalendars, listMembers, listEvents, findFreeSlots, createEvent];

export const toolNamed = (name: string) => ASSISTANT_TOOLS.find((t) => t.name === name);

export const LLM_TOOLS: LlmTool[] = ASSISTANT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: toLlmJsonSchema(t.input, "input") }));
