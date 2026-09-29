"use client";

import { ChevronLeft, ChevronRight, ChevronDown, CalendarPlus, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EventRow } from "@/components/event-row";
import { EventSheet, type EventSheetState } from "@/components/event-sheet";
import { MonthGrid } from "@/components/month-grid";
import { Button, cn, EmptyState, IconButton, Notice, Segmented, Sheet } from "@/components/ui";
import { useCalendarState, useHiddenCalendars } from "@/components/use-calendar-state";
import { api, errorMessage } from "@/lib/client-api";
import {
  addDays,
  addMonths,
  byStart,
  formatMonthDay,
  formatMonthTitle,
  isSameDay,
  monthGridRange,
  overlaps,
  startOfDay,
  startOfMonth,
  startOfWeek,
  WEEKDAYS,
} from "@/lib/dates";
import type { Calendar, CalendarEvent, CalendarState } from "@/lib/types";

type View = "month" | "week";

export function CalendarScreen({ initial, openCreate }: { initial: CalendarState; openCreate: boolean }) {
  const router = useRouter();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<View>("month");
  const [sheet, setSheet] = useState<EventSheetState>({ mode: "closed" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const range = useMemo(() => monthGridRange(month), [month]);
  const initialForCurrentMonth = useMemo(() => initial, [initial]);
  const { calendars, events, upsertEvent, removeEvent, loading, error } = useCalendarState(range.from, range.to, initialForCurrentMonth);
  const { hidden, toggle } = useHiddenCalendars();
  const visible = useMemo(() => events.filter((e) => !hidden.includes(e.calendarId)), [events, hidden]);

  // "+" in the tab bar / sidebar links to /?new=1.
  useEffect(() => {
    if (!openCreate) return;
    setSheet({ mode: "create", date: selectedDate });
    router.replace("/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate]);

  // Desktop shortcuts: c = new event, t = today.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey) return;
      if (e.key === "c") setSheet({ mode: "create", date: selectedDate });
      if (e.key === "t") goToday();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function goToday() {
    const today = startOfDay(new Date());
    setMonth(startOfMonth(today));
    setSelectedDate(today);
  }

  function selectDate(date: Date) {
    setSelectedDate(date);
    if (date.getMonth() !== month.getMonth()) setMonth(startOfMonth(date));
  }

  function step(direction: 1 | -1) {
    if (view === "month") {
      const next = addMonths(month, direction);
      setMonth(next);
      setSelectedDate(isSameDay(startOfMonth(new Date()), next) ? startOfDay(new Date()) : next);
    } else {
      selectDate(addDays(selectedDate, direction * 7));
    }
  }

  async function moveEvent(eventId: string, target: Date) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    const shift = startOfDay(target).getTime() - startOfDay(new Date(event.startsAt)).getTime();
    if (!shift) return;
    const moved = { ...event, startsAt: new Date(new Date(event.startsAt).getTime() + shift).toISOString(), endsAt: new Date(new Date(event.endsAt).getTime() + shift).toISOString() };
    upsertEvent(moved); // optimistic
    try {
      await api(`/events/${eventId}`, { method: "PATCH", body: { startsAt: moved.startsAt, endsAt: moved.endsAt } });
      setMoveError(null);
    } catch (e) {
      upsertEvent(event);
      setMoveError(errorMessage(e));
    }
  }

  const dayEvents = visible.filter((e) => overlaps(e, selectedDate, addDays(selectedDate, 1))).sort(byStart);
  const title = view === "month" ? formatMonthTitle(month) : `${formatMonthTitle(startOfWeek(selectedDate))} ${Math.ceil((startOfWeek(selectedDate).getDate() + 6) / 7)}주`;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="sticky top-0 z-30 flex items-center gap-1 bg-bg/90 px-3 py-2 backdrop-blur lg:static lg:px-8 lg:pb-4 lg:pt-7">
        <button
          aria-haspopup="dialog"
          aria-label={`${title}, 날짜 이동`}
          className="flex h-11 min-w-0 items-center gap-1 rounded-xl px-2 text-[21px] font-bold tracking-tight hover:bg-surface-2 lg:text-2xl"
          onClick={() => setPickerOpen(true)}
          type="button"
        >
          <span className="truncate">{title}</span>
          <ChevronDown className="shrink-0 text-fg-3" size={18} />
        </button>
        {loading ? <span aria-live="polite" className="sr-only">불러오는 중</span> : null}
        <div className="ml-auto flex items-center gap-0.5">
          <Button className="mr-1" onClick={goToday} size="sm" variant="secondary">
            오늘
          </Button>
          <IconButton label={view === "month" ? "이전 달" : "이전 주"} onClick={() => step(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <IconButton label={view === "month" ? "다음 달" : "다음 주"} onClick={() => step(1)}>
            <ChevronRight size={20} />
          </IconButton>
          <IconButton className="lg:hidden" label="캘린더 선택" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal size={19} />
          </IconButton>
        </div>
      </header>

      <div className="px-3 pb-3 lg:hidden">
        <Segmented label="보기" onChange={setView} options={[{ value: "month", label: "월" }, { value: "week", label: "주" }]} value={view} />
      </div>

      {error ? (
        <div className="px-3 pb-3 lg:px-8">
          <Notice>{error}</Notice>
        </div>
      ) : null}
      {moveError ? (
        <div className="px-3 pb-3 lg:px-8">
          <Notice>{moveError}</Notice>
        </div>
      ) : null}

      <div className="grid gap-5 px-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <div className={cn("min-w-0 transition-opacity", loading && "opacity-60")}>
          <div className="mb-3 hidden lg:block">
            <Segmented label="보기" onChange={setView} options={[{ value: "month", label: "월" }, { value: "week", label: "주" }]} value={view} />
          </div>
          {view === "month" ? (
            <MonthGrid
              events={visible}
              month={month}
              onMoveEvent={moveEvent}
              onOpenEvent={(event) => setSheet({ mode: "view", event })}
              onSelectDate={selectDate}
              selectedDate={selectedDate}
            />
          ) : (
            <WeekList events={visible} onOpen={(event) => setSheet({ mode: "view", event })} onSelect={selectDate} selectedDate={selectedDate} />
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[17px] font-bold">
                {formatMonthDay(selectedDate)}
                <span className="ml-1.5 text-sm font-semibold text-fg-3">{dayEvents.length ? `${dayEvents.length}개` : ""}</span>
              </h2>
              <Button onClick={() => setSheet({ mode: "create", date: selectedDate })} size="sm" variant="ghost">
                <CalendarPlus size={16} />
                추가
              </Button>
            </div>
            {dayEvents.length ? (
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <EventRow event={event} key={event.id} onOpen={(e) => setSheet({ mode: "view", event: e })} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-surface shadow-card">
                <EmptyState description="이 날은 비어 있어요." title="일정 없음" />
              </div>
            )}
          </section>

          <section className="hidden lg:block">
            <h2 className="mb-2 px-1 text-[13px] font-semibold text-fg-3">캘린더</h2>
            <CalendarFilter calendars={calendars} hidden={hidden} onToggle={toggle} />
          </section>
        </aside>
      </div>

      <EventSheet
        calendars={calendars}
        onChange={setSheet}
        onDeleted={(id) => {
          removeEvent(id);
          setSheet({ mode: "closed" });
        }}
        onSaved={(event) => {
          upsertEvent(event);
          setSheet({ mode: "view", event });
        }}
        state={sheet}
      />

      <Sheet onClose={() => setFilterOpen(false)} open={filterOpen} title="표시할 캘린더">
        <CalendarFilter calendars={calendars} hidden={hidden} onToggle={toggle} />
      </Sheet>

      <MonthPicker
        month={month}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          setMonth(picked);
          setSelectedDate(isSameDay(startOfMonth(new Date()), picked) ? startOfDay(new Date()) : picked);
          setView("month");
          setPickerOpen(false);
        }}
        open={pickerOpen}
      />
    </div>
  );
}

function CalendarFilter({ calendars, hidden, onToggle }: { calendars: Calendar[]; hidden: string[]; onToggle: (id: string) => void }) {
  return (
    <ul className="space-y-1 rounded-2xl bg-surface p-2 shadow-card">
      {calendars.map((calendar) => {
        const shown = !hidden.includes(calendar.id);
        return (
          <li key={calendar.id}>
            <button aria-pressed={shown} className="flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left hover:bg-surface-2" onClick={() => onToggle(calendar.id)} type="button">
              <span
                aria-hidden="true"
                className="flex size-5 items-center justify-center rounded-md border-2 transition-colors"
                style={{ borderColor: calendar.color, backgroundColor: shown ? calendar.color : "transparent" }}
              >
                {shown ? <span className="text-[11px] font-bold text-white">✓</span> : null}
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

function WeekList({ events, selectedDate, onSelect, onOpen }: { events: CalendarEvent[]; selectedDate: Date; onSelect: (date: Date) => void; onOpen: (event: CalendarEvent) => void }) {
  const start = startOfWeek(selectedDate);
  const today = new Date();
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => {
        const items = events.filter((e) => overlaps(e, date, addDays(date, 1))).sort(byStart);
        return (
          <div className="flex gap-3 p-3" key={date.toISOString()}>
            <button
              className={cn("flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5", isSameDay(date, selectedDate) ? "bg-primary-weak" : "hover:bg-surface-2")}
              onClick={() => onSelect(date)}
              type="button"
            >
              <span className={cn("text-xs font-semibold", date.getDay() === 0 ? "text-sunday" : date.getDay() === 6 ? "text-saturday" : "text-fg-3")}>{WEEKDAYS[date.getDay()]}</span>
              <span className={cn("mt-0.5 flex size-8 items-center justify-center rounded-full text-[15px] font-bold", isSameDay(date, today) && "bg-primary text-on-primary")}>{date.getDate()}</span>
            </button>
            <div className="min-w-0 flex-1 space-y-1.5 py-1">
              {items.length ? (
                items.map((event) => (
                  <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" key={event.id} onClick={() => onOpen(event)} type="button">
                    <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{event.title}</span>
                    <span className="shrink-0 text-xs text-fg-3">{event.allDay ? "종일" : new Date(event.startsAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-1.5 text-sm text-fg-3">일정 없음</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthPicker({ open, month, onPick, onClose }: { open: boolean; month: Date; onPick: (month: Date) => void; onClose: () => void }) {
  const [year, setYear] = useState(month.getFullYear());
  useEffect(() => setYear(month.getFullYear()), [month, open]);
  return (
    <Sheet onClose={onClose} open={open} title="날짜 이동">
      <div className="mb-4 flex items-center justify-between">
        <IconButton label="이전 해" onClick={() => setYear(year - 1)}>
          <ChevronLeft size={20} />
        </IconButton>
        <span className="text-lg font-bold">{year}년</span>
        <IconButton label="다음 해" onClick={() => setYear(year + 1)}>
          <ChevronRight size={20} />
        </IconButton>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 12 }, (_, i) => {
          const current = year === month.getFullYear() && i === month.getMonth();
          return (
            <button
              className={cn("h-12 rounded-xl text-[15px] font-semibold transition-colors", current ? "bg-primary text-on-primary" : "bg-surface-2 hover:bg-surface-3")}
              key={i}
              onClick={() => onPick(new Date(year, i, 1))}
              type="button"
            >
              {i + 1}월
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
