import type { CalendarEvent } from "./types";

export const DAY_MS = 86_400_000;
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
export const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);
export const startOfWeek = (date: Date) => addDays(startOfDay(date), -date.getDay());
export const isSameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

export const overlaps = (event: Pick<CalendarEvent, "startsAt" | "endsAt">, from: Date, to: Date) =>
  new Date(event.startsAt) < to && new Date(event.endsAt) > from;

export const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();

/** Visible range of a month grid: from the Sunday before the 1st to the Saturday after the last day. */
export function monthGridRange(month: Date) {
  const from = startOfWeek(startOfMonth(month));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { from, to: addDays(startOfWeek(last), 7) };
}

export type WeekBar = { event: CalendarEvent; start: number; span: number; lane: number; continuesBefore: boolean; continuesAfter: boolean };
export type MonthWeek = { days: Date[]; bars: WeekBar[]; laneCount: number };

/**
 * Weeks of the month grid with event bars packed into lanes, so a multi-day event is one bar across its days
 * and never overlaps another bar in the same week.
 */
export function buildMonthWeeks(month: Date, events: CalendarEvent[]): MonthWeek[] {
  const { from, to } = monthGridRange(month);
  const weeks: MonthWeek[] = [];

  for (let weekStart = from; weekStart < to; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const lanes: boolean[][] = [];
    const bars: WeekBar[] = [];

    for (const event of events.filter((e) => overlaps(e, weekStart, weekEnd)).sort(byStart)) {
      const startsAt = new Date(event.startsAt);
      const endsAt = new Date(event.endsAt);
      const start = Math.max(0, days.findIndex((day) => startsAt < addDays(day, 1)));
      // The last day the event touches (an all-day event ending at midnight does not touch that day).
      let end = 6;
      while (end > start && endsAt <= days[end]) end--;

      let lane = lanes.findIndex((used) => used.slice(start, end + 1).every((taken) => !taken));
      if (lane === -1) lane = lanes.push(Array(7).fill(false)) - 1;
      for (let i = start; i <= end; i++) lanes[lane][i] = true;

      bars.push({ event, start, span: end - start + 1, lane, continuesBefore: startsAt < weekStart, continuesAfter: endsAt > weekEnd });
    }
    weeks.push({ days, bars, laneCount: lanes.length });
  }
  return weeks;
}

const time = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const monthDay = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const fullDate = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const formatTime = (value: string | Date) => time.format(new Date(value));
export const formatMonthDay = (value: Date) => monthDay.format(value);
export const formatFullDate = (value: Date) => fullDate.format(value);
export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value));
export const formatMonthTitle = (value: Date) => `${value.getFullYear()}년 ${value.getMonth() + 1}월`;

/** "하루 종일", "10:00 – 11:30", or "9월 30일 (화) 10:00 – 10월 1일 …" for events that cross midnight. */
export function formatEventTime(event: Pick<CalendarEvent, "startsAt" | "endsAt" | "allDay">) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (event.allDay) {
    const lastDay = addDays(startOfDay(new Date(end.getTime() - 1)), 0);
    return isSameDay(start, lastDay) ? "하루 종일" : `${formatMonthDay(start)} – ${formatMonthDay(lastDay)}`;
  }
  return isSameDay(start, end) ? `${formatTime(start)} – ${formatTime(end)}` : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Value for <input type="datetime-local"> in local time. */
export const toDateTimeInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
/** Value for <input type="date">. */
export const toDateInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
