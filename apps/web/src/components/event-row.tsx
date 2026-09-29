"use client";

import { Star } from "lucide-react";

import { formatEventTime } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

export function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void }) {
  return (
    <button className="flex w-full items-stretch gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-2" onClick={() => onOpen(event)} type="button">
      <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-fg">{event.title}</span>
          {event.isImportant ? <Star aria-label="중요" className="size-3.5 shrink-0 fill-fg text-fg" /> : null}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-fg-2">
          {formatEventTime(event)} · {event.calendar.name}
          {event.location ? ` · ${event.location}` : ""}
        </span>
      </span>
    </button>
  );
}
