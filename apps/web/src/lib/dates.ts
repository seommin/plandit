import * as holidayYears from "@hyunbinseo/holidays-kr/all";

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

// --- Weekends and public holidays ---

/** Official public holidays from the government gazette (2018–2027); bump the package when a new year is announced. */
const HOLIDAYS: Record<string, readonly string[]> = Object.assign({}, ...Object.values(holidayYears));

export const holidayName = (date: Date) => HOLIDAYS[toDateInput(date)]?.join(", ");

/** Date color: red for Sundays and holidays, blue for Saturdays, otherwise none. */
export const dayTone = (date: Date) => (date.getDay() === 0 || holidayName(date) ? "text-sunday" : date.getDay() === 6 ? "text-saturday" : "");

// --- Time grid ---

export const minutesOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();
export const atMinutes = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
export const snap = (minutes: number, step = 15) => Math.round(minutes / step) * step;

/** Goes in the "종일" row rather than the hour grid: all-day, or long enough to cover whole days. */
export const isAllDayLike = (event: Pick<CalendarEvent, "allDay" | "startsAt" | "endsAt">) =>
  event.allDay || new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime() >= DAY_MS;

export type PositionedEvent = { event: CalendarEvent; startMin: number; endMin: number; column: number; columns: number };

/**
 * Timed events of one day, clipped to the day and laid out side by side where they overlap
 * (greedy columns inside each cluster of overlapping events).
 */
export function layoutDay(day: Date, events: CalendarEvent[]): PositionedEvent[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const items = events
    .filter((e) => !isAllDayLike(e) && overlaps(e, dayStart, dayEnd))
    .map((event) => {
      const start = Math.max(new Date(event.startsAt).getTime(), dayStart.getTime());
      const end = Math.min(new Date(event.endsAt).getTime(), dayEnd.getTime());
      const startMin = (start - dayStart.getTime()) / 60_000;
      return { event, startMin, endMin: Math.max(startMin + 15, (end - dayStart.getTime()) / 60_000), column: 0, columns: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster: PositionedEvent[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((i) => i.column + 1));
    cluster.forEach((i) => (i.columns = columns));
    cluster = [];
  };
  for (const item of items) {
    if (item.startMin >= clusterEnd) flush();
    const taken = new Set(cluster.filter((i) => i.endMin > item.startMin).map((i) => i.column));
    let column = 0;
    while (taken.has(column)) column++;
    item.column = column;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return items;
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
