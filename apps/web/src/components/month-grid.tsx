"use client";

import { type DragEvent, useMemo } from "react";

import { buildMonthWeeks, isSameDay, WEEKDAYS } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

import { cn } from "./ui";

/** Lanes shown per week before "+N": fewer on phones, where cells are ~53px wide. */
const MOBILE_LANES = 2;
const DESKTOP_LANES = 4;

type Props = {
  month: Date;
  events: CalendarEvent[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  /** desktop drag & drop: move an event to another day, keeping its time of day */
  onMoveEvent?: (eventId: string, date: Date) => void;
};

export function MonthGrid({ month, events, selectedDate, onSelectDate, onOpenEvent, onMoveEvent }: Props) {
  const weeks = useMemo(() => buildMonthWeeks(month, events), [month, events]);
  const today = new Date();

  const drop = (dragEvent: DragEvent, date: Date) => {
    dragEvent.preventDefault();
    const id = dragEvent.dataTransfer.getData("text/plain");
    if (id) onMoveEvent?.(id, date);
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((label, i) => (
          <div className={cn("py-2 text-center text-xs font-semibold", i === 0 ? "text-sunday" : i === 6 ? "text-saturday" : "text-fg-3")} key={label}>
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week) => {
        const hiddenCount = (lanes: number) =>
          week.days.map((_, day) => week.bars.filter((b) => b.lane >= lanes && day >= b.start && day < b.start + b.span).length);
        const hiddenMobile = hiddenCount(MOBILE_LANES);
        const hiddenDesktop = hiddenCount(DESKTOP_LANES);

        return (
          <div className="relative grid grid-cols-7 border-b border-line last:border-b-0" key={week.days[0].toISOString()}>
            {week.days.map((date, i) => {
              const inMonth = date.getMonth() === month.getMonth();
              const selected = isSameDay(date, selectedDate);
              const isToday = isSameDay(date, today);
              return (
                <button
                  aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일`}
                  aria-pressed={selected}
                  className={cn(
                    "flex min-h-[88px] flex-col items-center border-r border-line pt-1.5 last:border-r-0 lg:min-h-[118px] lg:items-start lg:px-2",
                    selected ? "bg-primary-weak/60" : "hover:bg-surface-2",
                  )}
                  key={date.toISOString()}
                  onClick={() => onSelectDate(date)}
                  onDragOver={(e) => onMoveEvent && e.preventDefault()}
                  onDrop={(e) => drop(e, date)}
                  type="button"
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-[13px] font-semibold",
                      selected
                        ? "bg-primary text-on-primary"
                        : isToday
                          ? "text-primary ring-1 ring-primary"
                          : !inMonth
                            ? "text-fg-3/60"
                            : i === 0
                              ? "text-sunday"
                              : i === 6
                                ? "text-saturday"
                                : "text-fg",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <span className="mt-auto pb-1 text-[10px] font-semibold text-fg-3 lg:hidden">{hiddenMobile[i] ? `+${hiddenMobile[i]}` : ""}</span>
                  <span className="mt-auto hidden pb-1 text-[11px] font-semibold text-fg-3 lg:block">{hiddenDesktop[i] ? `+${hiddenDesktop[i]}개` : ""}</span>
                </button>
              );
            })}

            <div className="pointer-events-none absolute inset-x-0 top-9 grid grid-cols-7 gap-y-[3px] px-[2px]" style={{ gridAutoRows: "18px" }}>
              {week.bars.map((bar) => (
                <span
                  className={cn("event-bar pointer-events-auto cursor-pointer mx-[1px]", bar.lane >= MOBILE_LANES && "hidden", bar.lane < DESKTOP_LANES && "lg:block")}
                  data-segment={bar.continuesBefore && bar.continuesAfter ? "middle" : bar.continuesBefore ? "end" : bar.continuesAfter ? "start" : undefined}
                  draggable={Boolean(onMoveEvent)}
                  key={`${bar.event.id}-${week.days[0].toISOString()}`}
                  onClick={() => onOpenEvent(bar.event)}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", bar.event.id)}
                  role="button"
                  style={{ gridColumn: `${bar.start + 1} / span ${bar.span}`, gridRow: bar.lane + 1, backgroundColor: bar.event.color }}
                  tabIndex={-1}
                  title={bar.event.title}
                >
                  {bar.event.title}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
