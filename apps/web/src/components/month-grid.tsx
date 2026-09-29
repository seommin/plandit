"use client";

import { type CSSProperties, type DragEvent, useMemo } from "react";

import { buildMonthWeeks, formatTime, isAllDayLike, isSameDay, WEEKDAYS } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

import { cn } from "./ui";

const LANES = 4;

type Props = {
  month: Date;
  events: CalendarEvent[];
  /** tap the date number */
  onOpenDay: (date: Date) => void;
  /** tap an empty part of the cell */
  onCreate: (date: Date) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  /** drag & drop onto another day, keeping the time of day */
  onMoveEvent: (event: CalendarEvent, date: Date) => void;
  canEdit: (event: CalendarEvent) => boolean;
};

/** Desktop month view. Multi-day and all-day events are tinted bars; timed events are a dot, time and title. */
export function MonthGrid({ month, events, onOpenDay, onCreate, onOpenEvent, onMoveEvent, canEdit }: Props) {
  const weeks = useMemo(() => buildMonthWeeks(month, events), [month, events]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const today = new Date();

  const drop = (dragEvent: DragEvent, date: Date) => {
    dragEvent.preventDefault();
    const event = byId.get(dragEvent.dataTransfer.getData("text/plain"));
    if (event) onMoveEvent(event, date);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((label) => (
          <div className="py-2 text-center text-[11px] font-semibold text-fg-3" key={label}>
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week) => {
        const hidden = week.days.map((_, day) => week.bars.filter((b) => b.lane >= LANES && day >= b.start && day < b.start + b.span).length);
        return (
          <div className="relative grid min-h-[120px] flex-1 grid-cols-7 border-b border-line last:border-b-0" key={week.days[0].toISOString()}>
            {week.days.map((date, i) => {
              const inMonth = date.getMonth() === month.getMonth();
              return (
                <div
                  className={cn("flex cursor-cell flex-col items-start px-1.5 pt-1.5", i > 0 && "border-l border-line", !inMonth && "bg-surface-2/40")}
                  key={date.toISOString()}
                  onClick={(e) => e.target === e.currentTarget && onCreate(date)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, date)}
                >
                  <button
                    aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일 보기`}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums transition-colors",
                      isSameDay(date, today) ? "bg-primary text-on-primary" : !inMonth ? "text-fg-3/60 hover:bg-surface-2" : "hover:bg-surface-2",
                    )}
                    onClick={() => onOpenDay(date)}
                    type="button"
                  >
                    {date.getDate()}
                  </button>
                  {hidden[i] ? (
                    <button className="mt-auto mb-1 rounded px-1 text-[11px] font-semibold text-fg-3 hover:bg-surface-2 hover:text-fg" onClick={() => onOpenDay(date)} type="button">
                      +{hidden[i]}개
                    </button>
                  ) : null}
                </div>
              );
            })}

            <div className="pointer-events-none absolute inset-x-0 top-10 grid grid-cols-7 gap-y-0.5 px-0.5" style={{ gridAutoRows: "22px" }}>
              {week.bars
                .filter((bar) => bar.lane < LANES)
                .map((bar) => {
                  const block = isAllDayLike(bar.event) || bar.span > 1;
                  return (
                    <button
                      className={cn(
                        "pointer-events-auto mx-0.5 flex min-w-0 items-center gap-1.5 truncate px-1.5 text-left text-[12px] font-semibold",
                        block ? "event-tint" : "rounded-md hover:bg-surface-2",
                        block && (bar.continuesBefore ? "rounded-l-none" : "rounded-l-md"),
                        block && (bar.continuesAfter ? "rounded-r-none" : "rounded-r-md"),
                      )}
                      draggable={canEdit(bar.event)}
                      key={`${bar.event.id}-${week.days[0].toISOString()}`}
                      onClick={() => onOpenEvent(bar.event)}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", bar.event.id)}
                      style={{ gridColumn: `${bar.start + 1} / span ${bar.span}`, gridRow: bar.lane + 1, "--event-color": bar.event.color } as CSSProperties}
                      title={bar.event.title}
                      type="button"
                    >
                      {!block ? <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: bar.event.color }} /> : null}
                      {!block ? <span className="shrink-0 font-medium tabular-nums text-fg-3">{formatTime(bar.event.startsAt)}</span> : null}
                      <span className="truncate">{bar.event.title}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
