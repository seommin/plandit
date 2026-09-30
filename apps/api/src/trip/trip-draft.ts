import { type TripDraft, tripDates, tripDraftSchema, type TripInput, type TripItem } from "@plandit/shared/trips";

import { isTimeZone, wallClockToInstant } from "../common/zoned-time";

/**
 * Checks the schema cannot express: every date inside the trip and at most once, each item ending after it starts
 * on the same day, a real time zone. Returns problems as `{ path, message }` (empty = fine).
 */
export function draftProblems(draft: Pick<TripDraft, "timezone" | "days">, input: Pick<TripInput, "startDate" | "endDate">) {
  const problems: Array<{ path: string; message: string }> = [];
  const allowed = new Set(tripDates(input.startDate, input.endDate));
  const seen = new Set<string>();

  if (!isTimeZone(draft.timezone)) problems.push({ path: "timezone", message: `Unknown time zone "${draft.timezone}".` });
  draft.days.forEach((day, d) => {
    if (!allowed.has(day.date)) problems.push({ path: `days.${d}.date`, message: `${day.date} is outside the trip.` });
    if (seen.has(day.date)) problems.push({ path: `days.${d}.date`, message: `${day.date} appears twice.` });
    seen.add(day.date);
    day.items.forEach((item, i) => {
      if (item.endTime <= item.startTime) problems.push({ path: `days.${d}.items.${i}.endTime`, message: "endTime must be after startTime." });
    });
  });
  return problems;
}

/** The model's reply → a checked draft, days and items in time order. Throws when anything is off (→ INVALID_OUTPUT). */
export function parseDraft(text: string, input: TripInput): TripDraft {
  const draft = tripDraftSchema.parse(JSON.parse(text));
  const problems = draftProblems(draft, input);
  if (problems.length) throw new Error(`Draft failed checks: ${problems.map((p) => p.path).join(", ")}`);
  return sortDraft(draft);
}

export function sortDraft<T extends Pick<TripDraft, "days">>(draft: T): T {
  return {
    ...draft,
    days: [...draft.days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({ ...day, items: [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime)) })),
  };
}

/** "2026-10-03" + "09:30" on the wall clock of `timeZone` → the real instant. */
export function localToInstant(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return wallClockToInstant(year, month, day, hour, minute, timeZone);
}

/**
 * Event rows for a draft. Events have no time zone of their own and show in the viewer's local time, so when the
 * trip's zone differs from the calendar's, the local time goes on the first line of the description.
 */
export function draftToEvents(draft: TripDraft, calendarTimezone: string) {
  const localNote = (item: TripItem) =>
    draft.timezone === calendarTimezone ? null : `현지 ${item.startTime}–${item.endTime} · ${draft.timezone}`;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return draft.days.flatMap((day) =>
    day.items.map((item) => {
      const startsAt = localToInstant(day.date, item.startTime, draft.timezone);
      // End = start + duration, so a DST change that day can never put the end before the start.
      const endsAt = new Date(startsAt.getTime() + (minutes(item.endTime) - minutes(item.startTime)) * 60_000);
      return {
        title: item.title,
        location: item.location,
        description: [localNote(item), item.description].filter(Boolean).join("\n") || null,
        startsAt,
        endsAt,
      };
    }),
  );
}
