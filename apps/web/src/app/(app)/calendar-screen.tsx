"use client";

import { ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { defaultStart, EventEditor, type EditorState } from "@/components/event-editor";
import { DateNavigator, MiniMonth, useDayDots } from "@/components/mini-month";
import { MonthGrid } from "@/components/month-grid";
import { TimeGrid } from "@/components/time-grid";
import { useToast } from "@/components/toast";
import { Button, cn, IconButton, Notice, Segmented, Sheet } from "@/components/ui";
import { useCalendarState, useHiddenCalendars } from "@/components/use-calendar-state";
import { api, errorMessage } from "@/lib/client-api";
import { addDays, addMonths, formatMonthDay, formatMonthTitle, formatTime, isSameDay, monthGridRange, startOfDay, startOfMonth, startOfWeek } from "@/lib/dates";
import { type Calendar, type CalendarEvent, type CalendarState, canWrite } from "@/lib/types";

type View = "day" | "week" | "month";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "월" },
];

/**
 * Phone: week strip (swipe for other weeks, pull down for the month) over one day's timeline.
 * Desktop: 일/주/월, week by default, with a mini month and the calendar list on wide screens.
 * Tap an empty time to add, tap an event to edit, drag to move, drag the bottom edge to change its length.
 */
export function CalendarScreen({ initial, openCreate }: { initial: CalendarState; openCreate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<View>("week");
  const [expanded, setExpanded] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const range = useMemo(() => monthGridRange(startOfMonth(selected)), [selected.getFullYear(), selected.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  const { calendars, events, upsertEvent, removeEvent, loading, error } = useCalendarState(range.from, range.to, initial);
  const { hidden, toggle } = useHiddenCalendars();
  const visible = useMemo(() => events.filter((e) => !hidden.includes(e.calendarId)), [events, hidden]);
  const dots = useDayDots(visible, range.from, range.to);

  const writable = useMemo(() => new Set(calendars.filter(canWrite).map((c) => c.id)), [calendars]);
  const canEdit = (event: CalendarEvent) => writable.has(event.calendarId);
  const create = (start: Date) => setEditor({ mode: "create", start });
  const open = (event: CalendarEvent) => setEditor({ mode: "edit", event });

  // "+" in the tab bar / sidebar links to /?new=1.
  useEffect(() => {
    if (!openCreate) return;
    create(defaultStart(selected));
    router.replace("/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate]);

  // Open at the current hour (08:00 on other days): page scroll on phones, the grid's own scroll on desktop.
  useEffect(() => {
    const hour = Math.max(new Date().getHours() - 1, 0);
    const scroller = scrollerRef.current;
    if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = hour * 48;
    else if (gridRef.current && headerRef.current) {
      window.scrollTo({ top: gridRef.current.getBoundingClientRect().top + window.scrollY + hour * 56 - headerRef.current.offsetHeight - 8 });
    }
  }, []);

  // Desktop shortcuts: c = new event, t = today, d/w/m = 일/주/월, ←/→ = previous/next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const views: Record<string, View> = { d: "day", w: "week", m: "month" };
      if (e.key === "c") create(defaultStart(selected));
      else if (e.key === "t") setSelected(startOfDay(new Date()));
      else if (views[e.key]) setView(views[e.key]);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") step(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function step(direction: 1 | -1) {
    if (view === "month") setSelected(addMonths(selected, direction));
    else setSelected(addDays(selected, view === "week" ? direction * 7 : direction));
  }

  /** Optimistic: move it now, save in the background, offer 되돌리기. */
  async function reschedule(event: CalendarEvent, startsAt: Date, endsAt: Date) {
    const moved = { ...event, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    upsertEvent(moved);
    try {
      await api(`/events/${event.id}`, { method: "PATCH", body: { startsAt: moved.startsAt, endsAt: moved.endsAt } });
      const label = event.allDay || isSameDay(startsAt, new Date(event.startsAt)) ? `${formatTime(startsAt)} – ${formatTime(endsAt)}` : `${formatMonthDay(startsAt)} ${formatTime(startsAt)}`;
      toast.show(event.allDay ? `${formatMonthDay(startsAt)}로 옮겼어요` : `${label}로 바꿨어요`, {
        label: "되돌리기",
        onClick: () => {
          upsertEvent(event);
          api(`/events/${event.id}`, { method: "PATCH", body: { startsAt: event.startsAt, endsAt: event.endsAt } }).catch((e) => {
            upsertEvent(moved);
            toast.show(errorMessage(e));
          });
        },
      });
    } catch (e) {
      upsertEvent(event);
      toast.show(errorMessage(e));
    }
  }

  function moveToDay(event: CalendarEvent, day: Date) {
    const shift = startOfDay(day).getTime() - startOfDay(new Date(event.startsAt)).getTime();
    if (shift) void reschedule(event, new Date(new Date(event.startsAt).getTime() + shift), new Date(new Date(event.endsAt).getTime() + shift));
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selected), i));
  const grid = { events: visible, canEdit, onOpen: open, onSlot: create, onReschedule: reschedule };

  return (
    <div className="lg:flex lg:h-dvh">
      <aside className="hidden w-72 shrink-0 space-y-6 overflow-y-auto border-r border-line px-4 py-5 xl:block">
        <MiniMonth dots={dots} key={`${selected.getFullYear()}-${selected.getMonth()}`} month={selected} onSelect={setSelected} selected={selected} withHeader />
        <section>
          <h2 className="mb-1 px-2 text-[12px] font-semibold text-fg-3">캘린더</h2>
          <CalendarFilter calendars={calendars} hidden={hidden} onToggle={toggle} />
        </section>
      </aside>

      <div className="min-w-0 flex-1 lg:flex lg:flex-col">
        <header className="sticky top-0 z-30 bg-bg/95 px-2 pt-[env(safe-area-inset-top)] border-b border-line backdrop-blur lg:static lg:px-6 lg:py-3" ref={headerRef}>
          <div className="flex h-14 items-center gap-1">
            <button
              aria-expanded={expanded}
              className="flex h-11 min-w-0 items-center gap-1 rounded-xl px-2 text-[22px] font-bold tracking-tight lg:pointer-events-none lg:text-[22px]"
              onClick={() => setExpanded(!expanded)}
              type="button"
            >
              <span className="truncate">{selected.getFullYear() === new Date().getFullYear() ? `${selected.getMonth() + 1}월` : formatMonthTitle(selected)}</span>
              <ChevronDown className={cn("shrink-0 text-fg-3 transition-transform lg:hidden", expanded && "rotate-180")} size={18} />
            </button>
            <span aria-live="polite" className={cn("size-1.5 rounded-full bg-fg-3 transition-opacity", loading ? "animate-pulse opacity-100" : "opacity-0")}>
              <span className="sr-only">{loading ? "불러오는 중" : ""}</span>
            </span>

            <div className="ml-auto flex items-center gap-1">
              <Button className="rounded-full" onClick={() => setSelected(startOfDay(new Date()))} size="sm" variant="secondary">
                오늘
              </Button>
              <div className="hidden items-center lg:flex">
                <IconButton label="이전" onClick={() => step(-1)}>
                  <ChevronLeft size={20} />
                </IconButton>
                <IconButton label="다음" onClick={() => step(1)}>
                  <ChevronRight size={20} />
                </IconButton>
              </div>
              <div className="ml-2 hidden lg:block">
                <Segmented label="보기" onChange={setView} options={VIEWS} value={view} />
              </div>
              <IconButton className="xl:hidden" label="표시할 캘린더" onClick={() => setFilterOpen(true)}>
                <SlidersHorizontal size={19} />
              </IconButton>
            </div>
          </div>

          <div className="lg:hidden">
            <DateNavigator dots={dots} expanded={expanded} onSelect={setSelected} onToggle={() => setExpanded(!expanded)} selected={selected} />
          </div>
        </header>

        {error ? (
          <div className="px-4 py-2 lg:px-6">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 lg:overflow-y-auto" ref={scrollerRef}>
          <div className="pt-2 lg:hidden" ref={gridRef}>
            <TimeGrid days={[selected]} {...grid} />
          </div>
          <div className="hidden h-full lg:block">
            {view === "month" ? (
              <MonthGrid
                canEdit={canEdit}
                events={visible}
                month={selected}
                onCreate={(day) => create(defaultStart(day))}
                onMoveEvent={moveToDay}
                onOpenDay={(day) => {
                  setSelected(day);
                  setView("day");
                }}
                onOpenEvent={open}
              />
            ) : (
              <TimeGrid days={view === "week" ? weekDays : [selected]} hourHeight={48} showDayHeaders {...grid} />
            )}
          </div>
        </div>
      </div>

      <EventEditor calendars={calendars} onClose={() => setEditor({ mode: "closed" })} onRemoved={removeEvent} onSaved={upsertEvent} state={editor} />

      <Sheet onClose={() => setFilterOpen(false)} open={filterOpen} title="표시할 캘린더">
        <CalendarFilter calendars={calendars} hidden={hidden} onToggle={toggle} />
      </Sheet>
    </div>
  );
}

function CalendarFilter({ calendars, hidden, onToggle }: { calendars: Calendar[]; hidden: string[]; onToggle: (id: string) => void }) {
  return (
    <ul>
      {calendars.map((calendar) => {
        const shown = !hidden.includes(calendar.id);
        return (
          <li key={calendar.id}>
            <button aria-pressed={shown} className="flex h-11 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-surface-2" onClick={() => onToggle(calendar.id)} type="button">
              <span
                aria-hidden="true"
                className="flex size-[18px] items-center justify-center rounded-[5px] border-2 transition-colors"
                style={{ borderColor: calendar.color, backgroundColor: shown ? calendar.color : "transparent" }}
              >
                {shown ? (
                  <svg className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth={3.5} viewBox="0 0 24 24">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                ) : null}
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[15px] font-medium", !shown && "text-fg-3")}>{calendar.name}</span>
              {calendar.type === "SHARED" ? <span className="text-xs text-fg-3">공유</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
