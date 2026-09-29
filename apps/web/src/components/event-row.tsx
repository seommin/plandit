"use client";

import { MapPin, Star } from "lucide-react";

import { formatEventTime } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

export function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void }) {
  return (
    <button
      className="flex w-full items-stretch gap-3 rounded-2xl bg-surface p-3.5 text-left shadow-card transition-colors hover:bg-surface-2"
      onClick={() => onOpen(event)}
      type="button"
    >
      <span aria-hidden="true" className="w-1 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-fg">{event.title}</span>
          {event.isImportant ? <Star aria-label="중요" className="size-3.5 shrink-0 fill-warning text-warning" /> : null}
        </span>
        <span className="mt-0.5 block text-[13px] font-medium text-fg-2">{formatEventTime(event)}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
          <span className="truncate">{event.calendar.name}</span>
          {event.location ? (
            <span className="flex min-w-0 items-center gap-0.5">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
