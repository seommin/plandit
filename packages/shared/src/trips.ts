import { z } from "zod";

/** AI travel itinerary (PLANDIT-26): the form, the model's draft, and the edits a user makes before applying it. */
export const TRIP_MAX_DAYS = 7;
export const TRIP_MAX_ITEMS_PER_DAY = 10;
export const TRIP_MAX_ATTENDEES = 20;

export const TRIP_PACES = ["RELAXED", "NORMAL", "PACKED"] as const;
export const TRIP_INTERESTS = ["SIGHTSEEING", "FOOD", "REST", "SHOPPING", "ACTIVITY"] as const;
export const TRIP_CATEGORIES = ["MOVE", "MEAL", "SIGHT", "STAY", "FREE"] as const;

export const TRIP_PACE_LABELS: Record<(typeof TRIP_PACES)[number], string> = { RELAXED: "여유롭게", NORMAL: "보통", PACKED: "알차게" };
export const TRIP_INTEREST_LABELS: Record<(typeof TRIP_INTERESTS)[number], string> = {
  SIGHTSEEING: "관광",
  FOOD: "맛집",
  REST: "휴식",
  SHOPPING: "쇼핑",
  ACTIVITY: "액티비티",
};
export const TRIP_CATEGORY_LABELS: Record<(typeof TRIP_CATEGORIES)[number], string> = {
  MOVE: "이동",
  MEAL: "식사",
  SIGHT: "구경",
  STAY: "숙소",
  FREE: "자유",
};

/** Days from start to end, both included ("2026-10-03".."2026-10-06" → 4). */
export function tripDayCount(startDate: string, endDate: string) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Every date of the trip, in order. */
export function tripDates(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return Array.from({ length: tripDayCount(startDate, endDate) }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

const isoDate = z.iso.date();

export const tripInputSchema = z
  .object({
    calendarId: z.string().min(1),
    destination: z.string().trim().min(1).max(80),
    startDate: isoDate,
    endDate: isoDate,
    /** Workspace members going along, not including the requester */
    attendeeUserIds: z.array(z.string().min(1)).max(TRIP_MAX_ATTENDEES).default([]),
    pace: z.enum(TRIP_PACES).default("NORMAL"),
    interests: z.array(z.enum(TRIP_INTERESTS)).max(TRIP_INTERESTS.length).default([]),
    /** Free text from the user, passed to the model as data */
    request: z.string().trim().max(500).default(""),
  })
  .refine((input) => input.endDate >= input.startDate, { message: "endDate must not be before startDate.", path: ["endDate"] })
  .refine((input) => tripDayCount(input.startDate, input.endDate) <= TRIP_MAX_DAYS, {
    message: `A trip can be at most ${TRIP_MAX_DAYS} days.`,
    path: ["endDate"],
  })
  .refine((input) => new Set(input.attendeeUserIds).size === input.attendeeUserIds.length, {
    message: "Each attendee can appear only once.",
    path: ["attendeeUserIds"],
  });
export type TripInput = z.infer<typeof tripInputSchema>;

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("현지 시각, 24시간 HH:mm");

export const tripItemSchema = z.object({
  title: z.string().trim().min(1).max(120).describe("일정 제목(한국어)"),
  startTime: clock,
  endTime: clock,
  location: z.string().trim().max(240).nullable().describe("장소 이름. 모르면 null"),
  description: z.string().trim().max(1000).nullable().describe("한두 문장 설명이나 팁. 없으면 null"),
  category: z.enum(TRIP_CATEGORIES).describe("MOVE 이동, MEAL 식사, SIGHT 구경, STAY 숙소, FREE 자유 시간"),
});
export type TripItem = z.infer<typeof tripItemSchema>;

export const tripDaySchema = z.object({
  date: isoDate.describe("YYYY-MM-DD, 여행 기간 안의 날짜"),
  items: z.array(tripItemSchema).min(1).max(TRIP_MAX_ITEMS_PER_DAY),
});

export const tripDaysSchema = z.array(tripDaySchema).min(1).max(TRIP_MAX_DAYS);

/** What the model returns (structured output), and what a READY plan stores. */
export const tripDraftSchema = z.object({
  timezone: z.string().trim().min(1).max(64).describe("목적지의 IANA 시간대 이름. 예: Asia/Tokyo"),
  days: tripDaysSchema,
  notes: z.string().trim().max(1000).nullable().describe("여행 전체에 대한 짧은 팁 2~3문장. 없으면 null"),
});
export type TripDraft = z.infer<typeof tripDraftSchema>;

/** Edits before applying: drop or change items, change who goes. */
export const tripPlanUpdateSchema = z
  .object({
    days: tripDaysSchema.optional(),
    attendeeUserIds: z.array(z.string().min(1)).max(TRIP_MAX_ATTENDEES).optional(),
  })
  .refine((update) => update.days !== undefined || update.attendeeUserIds !== undefined, { message: "Nothing to update." })
  .refine((update) => !update.attendeeUserIds || new Set(update.attendeeUserIds).size === update.attendeeUserIds.length, {
    message: "Each attendee can appear only once.",
    path: ["attendeeUserIds"],
  });

/** The people the user agreed to add to the calendar as viewers (must match what the server computes). */
export const tripApplySchema = z.object({
  newCalendarMemberIds: z.array(z.string().min(1)).max(TRIP_MAX_ATTENDEES).default([]),
});
