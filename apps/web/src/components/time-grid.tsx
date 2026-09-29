"use client";

import { type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { addDays, atMinutes, formatTime, isAllDayLike, isSameDay, layoutDay, minutesOfDay, overlaps, snap, startOfDay, WEEKDAYS } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

import { cn } from "./ui";

type Props = {
  days: Date[];
  events: CalendarEvent[];
  hourHeight?: number;
  canEdit: (event: CalendarEvent) => boolean;
  /** tap on an empty slot: create at that time */
  onSlot: (start: Date) => void;
  onOpen: (event: CalendarEvent) => void;
  /** drag (move) or bottom-edge drag (resize) finished */
  onReschedule: (event: CalendarEvent, startsAt: Date, endsAt: Date) => void;
  showDayHeaders?: boolean;
};

type Drag = {
  event: CalendarEvent;
  mode: "move" | "resize";
  pointerId: number;
  x: number;
  y: number;
  dayIndex: number;
  startMin: number;
  endMin: number;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
  // live preview
  previewDay: number;
  previewStart: number;
  previewEnd: number;
};

const LONG_PRESS_MS = 300;

/**
 * Hour grid for one day (phone) or a week (desktop).
 * Tap empty space → create there. Mouse: drag an event to move it, drag its bottom edge to resize.
 * Touch: long-press an event (≈0.3s) then drag; a quick swipe still scrolls the page.
 */
export function TimeGrid({ days, events, hourHeight = 56, canEdit, onSlot, onOpen, onReschedule, showDayHeaders }: Props) {
  const pxPerMin = hourHeight / 60;
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // While a touch drag is active, stop the page from scrolling under the finger.
  useEffect(() => {
    const block = (e: TouchEvent) => dragRef.current?.active && e.cancelable && e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  const columns = useMemo(() => days.map((day) => layoutDay(day, events)), [days, events]);
  const allDay = useMemo(
    () => days.map((day) => events.filter((e) => isAllDayLike(e) && overlaps(e, startOfDay(day), addDays(startOfDay(day), 1)))),
    [days, events],
  );
  const hasAllDay = allDay.some((list) => list.length);

  const columnWidth = () => (bodyRef.current ? bodyRef.current.getBoundingClientRect().width / days.length : 1);

  function begin(e: ReactPointerEvent, event: CalendarEvent, mode: Drag["mode"], dayIndex: number, startMin: number, endMin: number) {
    e.stopPropagation();
    const drag: Drag = { event, mode, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dayIndex, startMin, endMin, active: false, previewDay: dayIndex, previewStart: startMin, previewEnd: endMin };
    dragRef.current = drag;
    if (!canEdit(event)) return; // a tap still opens it
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType !== "mouse") {
      drag.timer = setTimeout(() => {
        drag.active = true;
        navigator.vibrate?.(8);
        setPreview({ ...drag });
      }, LONG_PRESS_MS);
    }
  }

  function move(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      const distance = Math.hypot(dx, dy);
      if (e.pointerType === "mouse" ? distance < 4 : distance > 8) {
        if (e.pointerType !== "mouse" && distance > 8) cancel(); // it's a scroll, not a drag
        return;
      }
      if (e.pointerType !== "mouse" || !canEdit(drag.event)) return;
      drag.active = true;
    }
    const deltaMin = snap(dy / pxPerMin, 15);
    if (drag.mode === "move") {
      const deltaDay = days.length > 1 ? Math.round(dx / columnWidth()) : 0;
      const duration = drag.endMin - drag.startMin;
      const start = Math.min(Math.max(drag.startMin + deltaMin, 0), 24 * 60 - 15);
      drag.previewDay = Math.min(Math.max(drag.dayIndex + deltaDay, 0), days.length - 1);
      drag.previewStart = start;
      drag.previewEnd = start + duration;
    } else {
      drag.previewEnd = Math.min(Math.max(drag.endMin + deltaMin, drag.startMin + 15), 24 * 60);
    }
    setPreview({ ...drag });
  }

  function end(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    clearTimeout(drag.timer);
    dragRef.current = null;
    setPreview(null);

    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) onOpen(drag.event); // a tap
      return;
    }
    const changed = drag.previewDay !== drag.dayIndex || drag.previewStart !== drag.startMin || drag.previewEnd !== drag.endMin;
    if (!changed) return;

    const original = { start: new Date(drag.event.startsAt), end: new Date(drag.event.endsAt) };
    if (drag.mode === "move") {
      // Shift the real times (the block may be clipped to this day) by the same amount.
      const shift = (drag.previewDay - drag.dayIndex) * 86_400_000 + (drag.previewStart - drag.startMin) * 60_000;
      onReschedule(drag.event, new Date(original.start.getTime() + shift), new Date(original.end.getTime() + shift));
    } else {
      onReschedule(drag.event, original.start, atMinutes(days[drag.dayIndex], drag.previewEnd));
    }
  }

  function cancel() {
    const drag = dragRef.current;
    if (drag) clearTimeout(drag.timer);
    dragRef.current = null;
    setPreview(null);
  }

  function slot(e: MouseEvent<HTMLDivElement>, day: Date) {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor((e.clientY - rect.top) / pxPerMin / 30) * 30;
    onSlot(atMinutes(day, Math.min(Math.max(minutes, 0), 23 * 60 + 30)));
  }

  const today = new Date();

  return (
    <div className="select-none">
      <div className={cn(showDayHeaders && "sticky top-0 z-20 bg-bg")}>
      {showDayHeaders ? (
        <div className="flex border-b border-line">
          <div className="w-14 shrink-0" />
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day) => (
              <div className="py-2 text-center" key={day.toISOString()}>
                <p className={cn("text-[11px] font-semibold", day.getDay() === 0 ? "text-sunday" : day.getDay() === 6 ? "text-saturday" : "text-fg-3")}>{WEEKDAYS[day.getDay()]}</p>
                <p className={cn("mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-[17px] font-semibold tabular-nums", isSameDay(day, today) && "bg-accent text-white")}>
                  {day.getDate()}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasAllDay ? (
        <div className="flex border-b border-line py-1.5">
          <div className="flex w-14 shrink-0 items-start justify-end pr-2 pt-1 text-[11px] font-medium text-fg-3">종일</div>
          <div className="grid flex-1 gap-x-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {allDay.map((list, i) => (
              <div className="min-w-0 space-y-1" key={i}>
                {list.map((event) => (
                  <button
                    className="event-tint block w-full truncate rounded-md px-2 py-1 text-left text-[12px] font-semibold"
                    key={event.id}
                    onClick={() => onOpen(event)}
                    style={{ "--event-color": event.color } as CSSProperties}
                    type="button"
                  >
                    {event.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      </div>

      <div className="relative flex" style={{ height: hourHeight * 24 }}>
        <div className="relative w-14 shrink-0" aria-hidden="true">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
            <span className="absolute right-2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-fg-3" key={hour} style={{ top: hour * hourHeight }}>
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        <div
          className="relative grid flex-1"
          ref={bodyRef}
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            backgroundImage: "linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
            backgroundSize: `100% ${hourHeight}px`,
          }}
        >
          {days.map((day, dayIndex) => (
            <div className={cn("relative cursor-cell", dayIndex > 0 && "border-l border-line")} key={day.toISOString()} onClick={(e) => slot(e, day)}>
              {columns[dayIndex].map(({ event, startMin, endMin, column, columns: count }) => {
                const dragging = preview?.event.id === event.id && preview.active;
                const short = endMin - startMin <= 45;
                return (
                  <div
                    className={cn(
                      "event-tint absolute overflow-hidden rounded-lg px-2 text-left [-webkit-touch-callout:none]",
                      short ? "py-0.5" : "py-1.5",
                      canEdit(event) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                      dragging && "opacity-30",
                    )}
                    key={event.id}
                    onPointerCancel={cancel}
                    onPointerDown={(e) => begin(e, event, "move", dayIndex, startMin, endMin)}
                    onPointerMove={move}
                    onPointerUp={end}
                    role="button"
                    style={
                      {
                        "--event-color": event.color,
                        top: startMin * pxPerMin + 1,
                        height: Math.max((endMin - startMin) * pxPerMin - 2, 18),
                        left: `calc(${(column / count) * 100}% + 2px)`,
                        width: `calc(${100 / count}% - 4px)`,
                      } as CSSProperties
                    }
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(event)}
                  >
                    <p className={cn("truncate font-semibold", short ? "text-[11px] leading-4" : "text-[13px] leading-5")}>
                      {event.title}
                      {short ? <span className="ml-1 font-medium text-fg-2">{formatTime(event.startsAt)}</span> : null}
                    </p>
                    {!short ? (
                      <p className="truncate text-[11px] font-medium text-fg-2">
                        {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    ) : null}
                    {canEdit(event) && endMin - startMin === (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000 ? (
                      <div
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize"
                        onPointerDown={(e) => begin(e, event, "resize", dayIndex, startMin, endMin)}
                      />
                    ) : null}
                  </div>
                );
              })}

              {preview?.active && preview.previewDay === dayIndex ? (
                <div
                  className="event-tint pointer-events-none absolute inset-x-0.5 z-10 rounded-lg px-2 py-1 shadow-float ring-2 ring-[var(--event-color)]"
                  style={{ "--event-color": preview.event.color, top: preview.previewStart * pxPerMin + 1, height: Math.max((preview.previewEnd - preview.previewStart) * pxPerMin - 2, 18) } as CSSProperties}
                >
                  <p className="truncate text-[13px] font-semibold">{preview.event.title}</p>
                  <p className="text-[11px] font-semibold tabular-nums text-fg-2">
                    {formatTime(atMinutes(day, preview.previewStart))} – {formatTime(atMinutes(day, preview.previewEnd))}
                  </p>
                </div>
              ) : null}

              {isSameDay(day, now) ? (
                <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: minutesOfDay(now) * pxPerMin }}>
                  <span className="-ml-1 size-2 rounded-full bg-accent" />
                  <span className="h-px flex-1 bg-accent" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
