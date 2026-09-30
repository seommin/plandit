import { ALL_DAY_REMINDER_HOUR } from "@plandit/shared/reminders";

import { partsIn, wallClockToInstant } from "../common/zoned-time";

/** `hour`:00 local time on the local calendar date that contains `instant`, as a real instant. */
export function localHourOnDate(instant: Date, timeZone: string, hour: number) {
  const { year, month, day } = partsIn(instant.getTime(), timeZone);
  return wallClockToInstant(year, month, day, hour, 0, timeZone);
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
