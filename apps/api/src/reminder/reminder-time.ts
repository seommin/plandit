import { ALL_DAY_REMINDER_HOUR } from "@plandit/shared/reminders";

type Parts = Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

function partsIn(instant: number, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])) as Parts;
}

/** UTC offset of `timeZone` at `instant`, in ms (Asia/Seoul → +9h). */
function offsetAt(instant: number, timeZone: string) {
  const p = partsIn(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/** `hour`:00 local time on the local calendar date that contains `instant`, as a real instant. */
export function localHourOnDate(instant: Date, timeZone: string, hour: number) {
  const { year, month, day } = partsIn(instant.getTime(), timeZone);
  const wallClock = Date.UTC(year, month - 1, day, hour);
  // Two passes so a DST change between the guess and the answer still lands on the right offset.
  const first = wallClock - offsetAt(wallClock, timeZone);
  return new Date(wallClock - offsetAt(first, timeZone));
}

/**
 * When a reminder fires. Timed events: start − minutesBefore.
 * All-day events: 09:00 on the start date in the calendar's timezone − minutesBefore
 * (so "0 minutes before" = 9 AM that day, "1440 minutes before" = 9 AM the day before).
 */
export function fireAtFor(event: { startsAt: Date; allDay: boolean }, minutesBefore: number, timeZone: string) {
  const base = event.allDay ? localHourOnDate(event.startsAt, timeZone, ALL_DAY_REMINDER_HOUR) : event.startsAt;
  return new Date(base.getTime() - minutesBefore * 60_000);
}
