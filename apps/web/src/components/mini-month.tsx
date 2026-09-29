"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type TouchEvent, useMemo, useRef, useState } from "react";

import { addDays, addMonths, dayKey, formatMonthTitle, isSameDay, monthGridRange, overlaps, startOfMonth, startOfWeek, WEEKDAYS } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

import { cn, IconButton } from "./ui";

/** Up to three event colors per day, for the dots under each date. */
export function useDayDots(events: CalendarEvent[], from: Date, to: Date) {
  return useMemo(() => {
    const dots = new Map<string, string[]>();
    for (let day = from; day < to; day = addDays(day, 1)) {
      const colors = events.filter((e) => overlaps(e, day, addDays(day, 1))).map((e) => e.color);
      if (colors.length) dots.set(dayKey(day), [...new Set(colors)].slice(0, 3));
    }
    return dots;
  }, [events, from, to]);
}

function DayCell({ date, selected, muted, dots, onSelect }: { date: Date; selected: boolean; muted?: boolean; dots?: string[]; onSelect: (date: Date) => void }) {
  const today = isSameDay(date, new Date());
  const weekday = date.getDay();
  return (
    <button
      aria-current={today ? "date" : undefined}
      aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일`}
      aria-pressed={selected}
      className="flex h-12 flex-col items-center justify-center gap-1"
      onClick={() => onSelect(date)}
      type="button"
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums transition-colors",
          selected ? "bg-primary text-on-primary" : today ? "text-accent" : muted ? "text-fg-3/60" : weekday === 0 ? "text-sunday" : weekday === 6 ? "text-saturday" : "text-fg",
          !selected && "hover:bg-surface-2",
        )}
      >
        {date.getDate()}
      </span>
      <span className="flex h-1 gap-0.5">
        {(dots ?? []).map((color, i) => (
          <span className="size-1 rounded-full" key={i} style={{ backgroundColor: color }} />
        ))}
      </span>
    </button>
  );
}

export function WeekdayHeader() {
  return (
    <div className="grid grid-cols-7">
      {WEEKDAYS.map((label, i) => (
        <span className={cn("py-1 text-center text-[11px] font-semibold", i === 0 ? "text-sunday/80" : i === 6 ? "text-saturday/80" : "text-fg-3")} key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** A month of dates (6 rows max) with dots; `withHeader` adds its own ‹ month › navigation (used in the editor). */
export function MiniMonth({
  month,
  selected,
  onSelect,
  dots,
  withHeader,
}: {
  month: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  dots?: Map<string, string[]>;
  withHeader?: boolean;
}) {
  const [shown, setShown] = useState(startOfMonth(month));
  const current = withHeader ? shown : startOfMonth(month);
  const { from, to } = monthGridRange(current);
  const days: Date[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);

  return (
    <div>
      {withHeader ? (
        <div className="mb-1 flex items-center justify-between">
          <IconButton label="이전 달" onClick={() => setShown(addMonths(shown, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <span className="text-[15px] font-semibold">{formatMonthTitle(shown)}</span>
          <IconButton label="다음 달" onClick={() => setShown(addMonths(shown, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      ) : null}
      <WeekdayHeader />
      <div className="grid grid-cols-7">
        {days.map((date) => (
          <DayCell date={date} dots={dots?.get(dayKey(date))} key={date.toISOString()} muted={date.getMonth() !== current.getMonth()} onSelect={onSelect} selected={isSameDay(date, selected)} />
        ))}
      </div>
    </div>
  );
}

/**
 * The strip under the header: one week (swipe ←/→ for the previous/next week) that expands into the whole month.
 */
export function DateNavigator({
  selected,
  onSelect,
  dots,
  expanded,
  onToggle,
}: {
  selected: Date;
  onSelect: (date: Date) => void;
  dots: Map<string, string[]>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  const weekStart = startOfWeek(selected);

  const onTouchEnd = (e: TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      onSelect(expanded ? addMonths(selected, dx < 0 ? 1 : -1) : addDays(selected, dx < 0 ? 7 : -7));
    } else if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) && (dy > 0) !== expanded) {
      onToggle(); // pull down to open the month, push up to close it
    }
  };

  return (
    <div onTouchEnd={onTouchEnd} onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}>
      {expanded ? (
        <MiniMonth dots={dots} month={selected} onSelect={onSelect} selected={selected} />
      ) : (
        <>
          <WeekdayHeader />
          <div className="grid grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date) => (
              <DayCell date={date} dots={dots.get(dayKey(date))} key={date.toISOString()} onSelect={onSelect} selected={isSameDay(date, selected)} />
            ))}
          </div>
        </>
      )}
      <button aria-expanded={expanded} aria-label={expanded ? "달력 접기" : "달력 펼치기"} className="flex h-5 w-full items-center justify-center" onClick={onToggle} type="button">
        <span className="h-1 w-9 rounded-full bg-surface-3" />
      </button>
    </div>
  );
}
