import { wallClockToInstant } from "../common/zoned-time";

export type Interval = { start: Date; end: Date };

export type FreeRangeQuery = {
  /** Local dates, both included (YYYY-MM-DD) */
  fromDate: string;
  toDate: string;
  /** Local wall-clock window per day (HH:mm) */
  dayStart: string;
  dayEnd: string;
  timezone: string;
  includeWeekends: boolean;
  minMinutes: number;
  busy: Interval[];
  /** Nothing before this (now, rounded up to the next half hour) */
  notBefore: Date;
};

const DAY = 86_400_000;
const HALF_HOUR = 30 * 60_000;

/** Now rounded up to the next :00 or :30, so a suggestion never starts at 14:07. */
export const nextHalfHour = (now: Date) => new Date(Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR);

/**
 * Free stretches of at least `minMinutes` inside each day's window, outside every busy interval. Returned as ranges
 * ("10:00–12:00 is free") rather than one start per half hour, so the model can pick a time and explain it.
 */
export function freeRanges(q: FreeRangeQuery): Interval[] {
  const [startHour, startMinute] = q.dayStart.split(":").map(Number);
  const [endHour, endMinute] = q.dayEnd.split(":").map(Number);
  const busy = [...q.busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const ranges: Interval[] = [];

  for (let day = Date.parse(`${q.fromDate}T00:00:00Z`); day <= Date.parse(`${q.toDate}T00:00:00Z`); day += DAY) {
    const date = new Date(day);
    const weekday = date.getUTCDay(); // the calendar date's weekday, whatever the time zone
    if (!q.includeWeekends && (weekday === 0 || weekday === 6)) continue;

    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const windowEnd = wallClockToInstant(y, m, d, endHour, endMinute, q.timezone).getTime();
    let cursor = Math.max(wallClockToInstant(y, m, d, startHour, startMinute, q.timezone).getTime(), q.notBefore.getTime());

    for (const b of busy) {
      if (b.end.getTime() <= cursor || b.start.getTime() >= windowEnd) continue;
      if (b.start.getTime() > cursor) ranges.push({ start: new Date(cursor), end: b.start });
      cursor = Math.max(cursor, b.end.getTime());
    }
    if (cursor < windowEnd) ranges.push({ start: new Date(cursor), end: new Date(windowEnd) });
  }
  return ranges.filter((r) => r.end.getTime() - r.start.getTime() >= q.minMinutes * 60_000);
}
