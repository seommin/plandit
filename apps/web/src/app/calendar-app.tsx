"use client";

import { type CSSProperties, FormEvent, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  Share2,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";

type CalendarType = "PERSONAL" | "SHARED" | "SUBSCRIBED";
type CalendarRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type CalendarAppCalendar = {
  id: string;
  name: string;
  type: CalendarType;
  color: string;
  role: CalendarRole;
};

export type CalendarAppEvent = {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  color: string;
  visibility: "PRIVATE" | "CALENDAR" | "PUBLIC_LINK";
  calendar: {
    id: string;
    name: string;
    type: CalendarType;
    color: string;
  };
};

type CalendarAppProps = {
  calendars: CalendarAppCalendar[];
  events: CalendarAppEvent[];
  user: {
    id: string;
    name: string;
    email: string;
  };
};

type CalendarDayEvent = {
  event: CalendarAppEvent;
  lane: number;
};

const weekDays = [
  { label: "일", tone: "text-[#d64f68]" },
  { label: "월", tone: "text-[var(--muted)]" },
  { label: "화", tone: "text-[var(--muted)]" },
  { label: "수", tone: "text-[var(--muted)]" },
  { label: "목", tone: "text-[var(--muted)]" },
  { label: "금", tone: "text-[var(--muted)]" },
  { label: "토", tone: "text-[#2f6bff]" },
];

const navItems = [
  ["오늘", CalendarDays],
  ["공유 캘린더", Share2],
  ["초대", Users],
] as const;

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
});

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

function formatMonthLabel(month: Date) {
  return `${month.getFullYear()}. ${String(month.getMonth() + 1).padStart(2, "0")}`;
}

function toInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  const end = startOfDay(date);
  end.setDate(end.getDate() + 1);
  return end;
}

function eventOverlapsRange(event: CalendarAppEvent, rangeStart: Date, rangeEnd: Date) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);

  return startsAt < rangeEnd && endsAt > rangeStart;
}

function eventOverlapsDay(event: CalendarAppEvent, date: Date) {
  return eventOverlapsRange(event, startOfDay(date), endOfDay(date));
}

function getEventWeekSpan(event: CalendarAppEvent, week: Array<{ date: Date }>) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);

  const startIndex = week.findIndex((day) => startsAt < endOfDay(day.date));
  let endIndex = -1;

  for (let index = week.length - 1; index >= 0; index -= 1) {
    if (endsAt > startOfDay(week[index].date)) {
      endIndex = index;
      break;
    }
  }

  return {
    endIndex: Math.max(endIndex, 0),
    startIndex: Math.max(startIndex, 0),
  };
}

function buildMonthDays(month: Date, events: CalendarAppEvent[]) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const days = Array.from({ length: cells }, (_, index) => {
    const day = index - startOffset + 1;
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const dayOfWeek = index % 7;

    return {
      key: date.toISOString(),
      date,
      events: [] as CalendarDayEvent[],
      label: date.getDate(),
      muted: day < 1 || day > daysInMonth,
      isSunday: dayOfWeek === 0,
      isSaturday: dayOfWeek === 6,
      isHoliday:
        month.getFullYear() === 2026 && month.getMonth() === 5 && day === 6,
      today:
        date.toDateString() === new Date().toDateString(),
      weekLaneCount: 0,
    };
  });

  for (let weekStartIndex = 0; weekStartIndex < days.length; weekStartIndex += 7) {
    const week = days.slice(weekStartIndex, weekStartIndex + 7);
    const weekStart = startOfDay(week[0].date);
    const weekEnd = endOfDay(week[week.length - 1].date);
    const lanes: boolean[][] = [];
    const weekEvents = events
      .filter((event) => eventOverlapsRange(event, weekStart, weekEnd))
      .sort((a, b) => {
        const startsAtDelta = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

        if (startsAtDelta !== 0) {
          return startsAtDelta;
        }

        return new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();
      });

    weekEvents.forEach((event) => {
      const { startIndex, endIndex } = getEventWeekSpan(event, week);
      let lane = lanes.findIndex((items) =>
        items.slice(startIndex, endIndex + 1).every((occupied) => !occupied),
      );

      if (lane === -1) {
        lane = lanes.length;
        lanes.push(Array(7).fill(false));
      }

      for (let index = startIndex; index <= endIndex; index += 1) {
        lanes[lane][index] = true;
      }

      week.forEach((day) => {
        if (eventOverlapsDay(event, day.date)) {
          day.events.push({ event, lane });
        }
      });
    });

    week.forEach((day) => {
      day.events.sort((a, b) => a.lane - b.lane);
      day.weekLaneCount = lanes.length;
    });
  }

  return days;
}

function getEventSegment(event: CalendarAppEvent, date: Date) {
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dateEnd = new Date(dateStart);
  dateEnd.setDate(dateEnd.getDate() + 1);

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const startsToday = startsAt >= dateStart && startsAt < dateEnd;
  const endsToday = endsAt > dateStart && endsAt <= dateEnd;

  if (startsToday && endsToday) {
    return "single";
  }

  if (startsToday) {
    return "start";
  }

  if (endsToday) {
    return "end";
  }

  return "middle";
}

function getEventPillClass(event: CalendarAppEvent, date: Date) {
  const segment = getEventSegment(event, date);
  const segmentClass = {
    single: "",
    start: "event-pill-start",
    middle: "event-pill-middle",
    end: "event-pill-end",
  }[segment];

  return ["event-pill block text-left", segmentClass].filter(Boolean).join(" ");
}

function shouldShowEventTitle(event: CalendarAppEvent, date: Date) {
  const segment = getEventSegment(event, date);

  return segment === "single" || segment === "start";
}

export default function CalendarApp({ calendars, events, user }: CalendarAppProps) {
  const [selectedCalendarIds, setSelectedCalendarIds] = useState(() =>
    calendars.map((calendar) => calendar.id),
  );
  const [month, setMonth] = useState(() => new Date(2026, 5, 1));
  const [eventItems, setEventItems] = useState(events);
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? "");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isImportantOpen, setIsImportantOpen] = useState(false);
  const [importantEventIds, setImportantEventIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const visibleEvents = useMemo(
    () =>
      eventItems.filter((event) => selectedCalendarIds.includes(event.calendarId)),
    [eventItems, selectedCalendarIds],
  );

  const monthDays = useMemo(
    () => buildMonthDays(month, visibleEvents),
    [month, visibleEvents],
  );
  const monthWeeks = useMemo(
    () =>
      Array.from({ length: Math.ceil(monthDays.length / 7) }, (_, index) =>
        monthDays.slice(index * 7, index * 7 + 7),
      ),
    [monthDays],
  );

  const selectedEvent = useMemo(() => {
    return (
      eventItems.find((event) => event.id === selectedEventId) ??
      visibleEvents[0] ??
      eventItems[0] ??
      null
    );
  }, [eventItems, selectedEventId, visibleEvents]);

  const agenda = useMemo(
    () =>
      visibleEvents
        .slice()
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .slice(0, 5),
    [visibleEvents],
  );

  const importantEvents = useMemo(
    () =>
      eventItems
        .filter((event) => importantEventIds.includes(event.id))
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [eventItems, importantEventIds],
  );

  const writableCalendars = calendars.filter((calendar) =>
    ["OWNER", "ADMIN", "EDITOR"].includes(calendar.role),
  );

  function toggleCalendar(calendarId: string) {
    setSelectedCalendarIds((current) =>
      current.includes(calendarId)
        ? current.filter((id) => id !== calendarId)
        : [...current, calendarId],
    );
  }

  function selectAllCalendars() {
    setSelectedCalendarIds(calendars.map((calendar) => calendar.id));
  }

  function toggleImportantEvent(eventId: string) {
    setImportantEventIds((current) =>
      current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId],
    );
  }

  function goToToday() {
    setMonth(new Date(2026, 5, 1));
  }

  function openCreateModal() {
    setFormError(null);
    setIsCreateOpen(true);
  }

  function openEventDetail(eventId: string) {
    setSelectedEventId(eventId);
    setIsDetailOpen(true);
  }

  function openEditModal() {
    setFormError(null);
    setIsDetailOpen(false);
    setIsEditOpen(true);
  }

  function buildCalendarEvent(event: CalendarAppEvent, calendarId: string) {
    const calendar = calendars.find((item) => item.id === calendarId);

    return {
      ...event,
      color: event.color ?? calendar?.color ?? "var(--blue)",
      calendar: {
        id: calendar?.id ?? calendarId,
        name: calendar?.name ?? "내 캘린더",
        type: calendar?.type ?? "PERSONAL",
        color: calendar?.color ?? "var(--blue)",
      },
    } satisfies CalendarAppEvent;
  }

  function getEventPayload(data: FormData) {
    const startsAt = new Date(String(data.get("startsAt")));
    const endsAt = new Date(String(data.get("endsAt")));

    if (endsAt <= startsAt) {
      throw new Error("종료 일시는 시작 일시보다 뒤여야 합니다.");
    }

    return {
      calendarId: String(data.get("calendarId")),
      title: String(data.get("title")),
      description: String(data.get("description") ?? ""),
      location: String(data.get("location") ?? ""),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFormError(null);

    const data = new FormData(event.currentTarget);

    try {
      const payload = getEventPayload(data);
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "일정을 저장하지 못했습니다.");
      }

      const createdEvent = buildCalendarEvent(result.event, result.event.calendarId);

      setEventItems((current) => [...current, createdEvent]);
      setSelectedCalendarIds((current) =>
        current.includes(createdEvent.calendarId)
          ? current
          : [...current, createdEvent.calendarId],
      );
      setSelectedEventId(createdEvent.id);
      setIsCreateOpen(false);
      setIsDetailOpen(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedEvent) {
      return;
    }

    setIsSaving(true);
    setFormError(null);

    const data = new FormData(event.currentTarget);

    try {
      const payload = getEventPayload(data);
      const response = await fetch(`/api/events/${selectedEvent.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "일정을 수정하지 못했습니다.");
      }

      const updatedEvent = buildCalendarEvent(result.event, result.event.calendarId);

      setEventItems((current) =>
        current.map((item) => (item.id === updatedEvent.id ? updatedEvent : item)),
      );
      setSelectedEventId(updatedEvent.id);
      setIsEditOpen(false);
      setIsDetailOpen(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteEvent() {
    if (!selectedEvent) {
      return;
    }

    const shouldDelete = window.confirm("이 일정을 삭제할까요?");

    if (!shouldDelete) {
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/events/${selectedEvent.id}`, {
        method: "DELETE",
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "일정을 삭제하지 못했습니다.");
      }

      setEventItems((current) => {
        const nextItems = current.filter((item) => item.id !== selectedEvent.id);
        setSelectedEventId(nextItems[0]?.id ?? "");
        return nextItems;
      });
      setImportantEventIds((current) => current.filter((id) => id !== selectedEvent.id));
      setIsEditOpen(false);
      setIsDetailOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  const defaultStartsAt = toInputValue(new Date(2026, 5, 9, 9, 0));
  const defaultEndsAt = toInputValue(new Date(2026, 5, 9, 10, 0));

  return (
    <main className="app-shell">
      <div className="fixed inset-x-0 top-0 z-30 grid h-14 grid-cols-[56px_minmax(0,1fr)_56px] items-center bg-[var(--ink)] px-1 text-white md:hidden">
        <button
          className="flex size-12 items-center justify-center rounded-lg"
          aria-label="캘린더 메뉴"
          onClick={() => setIsMobileMenuOpen(true)}
          type="button"
        >
          <Menu size={23} />
        </button>
        <p className="mobile-brand-script text-center text-[28px] leading-none">Plandit</p>
        <button
          className="flex size-12 items-center justify-center rounded-lg"
          aria-label="알림"
          onClick={() => setIsNotificationOpen(true)}
          type="button"
        >
          <Bell size={22} />
        </button>
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] gap-4 px-4 pb-24 pt-[72px] md:pb-4 md:pt-4 lg:px-6">
        <aside className="hidden w-[272px] shrink-0 flex-col rounded-lg border border-[var(--line)] bg-[#fdfcf9] p-4 lg:flex">
          <div>
            <div className="mb-7 flex h-10 items-center justify-center">
              <p className="mobile-brand-script text-[30px] leading-none">Plandit</p>
            </div>

            <button
              className="mb-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ink)] px-4 text-sm font-semibold text-white"
              onClick={openCreateModal}
            >
              <Plus size={17} />
              새 일정
            </button>

            <nav className="space-y-1 text-sm font-medium">
              {navItems.map(([label, Icon]) => (
                <button
                  key={label}
                  className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[#34362f] hover:bg-[#efeee9]"
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between px-3">
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  캘린더 목록
                </p>
                <button
                  className="text-xs font-semibold uppercase text-[var(--muted)] hover:text-[var(--ink)]"
                  onClick={selectAllCalendars}
                  type="button"
                >
                  전체 선택
                </button>
              </div>
              <div className="space-y-2">
                {calendars.map((calendar) => (
                  <label
                    key={calendar.id}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#efeee9]"
                  >
                    <input
                      checked={selectedCalendarIds.includes(calendar.id)}
                      className="size-4 accent-[var(--ink)]"
                      onChange={() => toggleCalendar(calendar.id)}
                      type="checkbox"
                    />
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className="text-sm text-[#34362f]">{calendar.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[#fdfcf9] px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-3 md:w-full md:max-w-[420px]">
              <button
                className="icon-button"
                aria-label="Previous month"
                title="Previous month"
                onClick={() =>
                  setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
                }
              >
                <ChevronLeft size={18} />
              </button>
              <h1 className="text-center text-xl font-semibold leading-tight sm:text-2xl">
                {formatMonthLabel(month)}
              </h1>
              <button
                className="icon-button"
                aria-label="Next month"
                title="Next month"
                onClick={() =>
                  setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="hidden items-center justify-end gap-2 md:flex">
              <button className="icon-button" aria-label="Notifications" title="Notifications">
                <Bell size={18} />
              </button>
              <button className="icon-button" aria-label="Settings" title="Settings">
                <Settings2 size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-4">
            <div className="panel min-w-0 overflow-hidden">
              <div className="calendar-grid border-b border-[var(--line)] bg-[#f9f8f4]">
                {weekDays.map((day) => (
                  <div
                    key={day.label}
                    className={`px-3 py-3 text-center text-xs font-semibold ${day.tone}`}
                  >
                    {day.label}
                  </div>
                ))}
              </div>
              <div className="calendar-body">
                {monthWeeks.map((week, weekIndex) => (
                  <div className="calendar-week" key={`${month.toISOString()}-${weekIndex}`}>
                    {week.map((day) => (
                      <button
                        key={day.key}
                        className="day-cell bg-white/70 text-left"
                        onDoubleClick={openCreateModal}
                        style={
                          {
                            "--week-lane-count": day.weekLaneCount,
                          } as CSSProperties
                        }
                      >
                        <div className="day-number-row">
                          <span
                            className={[
                              "flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                              day.today
                                ? "bg-[var(--ink)] text-white"
                                : day.muted
                                  ? "text-[#a2a59b]"
                                  : day.isSunday || day.isHoliday
                                    ? "text-[#d64f68]"
                                    : day.isSaturday
                                      ? "text-[#2f6bff]"
                                      : "text-[#30322d]",
                            ].join(" ")}
                          >
                            {day.label}
                          </span>
                        </div>
                        <div className="event-stack">
                          {day.events.map(({ event, lane }) => (
                            <span
                              key={`${event.id}-${day.key}`}
                              className={getEventPillClass(event, day.date)}
                              style={{
                                backgroundColor: event.color,
                                gridRowStart: lane + 1,
                              }}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                openEventDetail(event.id);
                              }}
                            >
                              {shouldShowEventTitle(event, day.date) ? event.title : null}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <section className="panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">오늘 일정</h2>
                <Clock3 size={18} className="text-[var(--muted)]" />
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {agenda.length > 0 ? (
                  agenda.map((item) => (
                    <button
                      key={item.id}
                      className={[
                        "flex w-full gap-3 rounded-lg border bg-white p-3 text-left",
                        selectedEventId === item.id
                          ? "border-[#9fa598]"
                          : "border-[var(--line)]",
                      ].join(" ")}
                      onClick={() => openEventDetail(item.id)}
                    >
                      <div
                        className="mt-1 size-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          {timeFormatter.format(new Date(item.startsAt))}
                        </p>
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-[var(--muted)]">{item.calendar.name}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="rounded-lg border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)] md:col-span-2 xl:col-span-3">
                    선택한 캘린더에 표시할 일정이 없습니다.
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[#fdfcf9]/95 px-3 py-2 shadow-[0_-12px_40px_rgba(31,33,29,0.08)] backdrop-blur md:hidden">
        <nav className="mx-auto grid max-w-[520px] grid-cols-5 items-center gap-1">
          <button
            className="flex h-14 items-center justify-center rounded-lg text-[#34362f] hover:bg-[#efeee9]"
            aria-label="오늘"
            title="오늘"
            onClick={goToToday}
          >
            <CalendarDays size={21} />
          </button>
          <button
            className="flex h-14 items-center justify-center rounded-lg text-[#34362f] hover:bg-[#efeee9]"
            aria-label="중요 일정"
            title="중요 일정"
            onClick={() => setIsImportantOpen(true)}
          >
            <Star size={21} />
          </button>
          <button
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-[0_12px_28px_rgba(24,25,22,0.24)]"
            aria-label="새 일정"
            title="새 일정"
            onClick={openCreateModal}
          >
            <Plus size={25} />
          </button>
          <button
            className="flex h-14 items-center justify-center rounded-lg text-[#34362f] hover:bg-[#efeee9]"
            aria-label="검색"
            title="검색"
            type="button"
          >
            <Search size={21} />
          </button>
          <button
            className="flex h-14 items-center justify-center rounded-lg text-[#34362f] hover:bg-[#efeee9]"
            aria-label="설정"
            title="설정"
            type="button"
          >
            <Settings2 size={21} />
          </button>
        </nav>
      </footer>

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-40 bg-black/35 md:hidden">
          <aside className="h-full w-[84vw] max-w-[320px] bg-[#fdfcf9] p-4 shadow-[24px_0_60px_rgba(31,33,29,0.18)]">
            <div className="mb-5 flex items-center justify-between">
              <p className="mobile-brand-script text-[30px] leading-none">Plandit</p>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsMobileMenuOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <button
              className="mb-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ink)] px-4 text-sm font-semibold text-white"
              onClick={() => {
                setIsMobileMenuOpen(false);
                openCreateModal();
              }}
              type="button"
            >
              <Plus size={17} />
              새 일정
            </button>

            <nav className="mb-6 space-y-1 text-sm font-medium">
              {navItems.map(([label, Icon]) => (
                <button
                  key={label}
                  className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[#34362f] hover:bg-[#efeee9]"
                  type="button"
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </nav>

            <div>
              <div className="mb-3 flex items-center justify-between px-3">
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  캘린더 목록
                </p>
                <button
                  className="text-xs font-semibold uppercase text-[var(--muted)] hover:text-[var(--ink)]"
                  onClick={selectAllCalendars}
                  type="button"
                >
                  전체 선택
                </button>
              </div>
              <div className="space-y-2">
                {calendars.map((calendar) => (
                  <label
                    key={calendar.id}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#efeee9]"
                  >
                    <input
                      checked={selectedCalendarIds.includes(calendar.id)}
                      className="size-4 accent-[var(--ink)]"
                      onChange={() => toggleCalendar(calendar.id)}
                      type="checkbox"
                    />
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className="text-sm text-[#34362f]">{calendar.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {isNotificationOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/35 md:hidden">
          <aside className="h-full w-[84vw] max-w-[320px] bg-[#fdfcf9] p-4 shadow-[-24px_0_60px_rgba(31,33,29,0.18)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold">알림</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsNotificationOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--line)] bg-white p-3">
                <p className="text-sm font-semibold">오늘 일정 확인</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  선택한 캘린더의 다가오는 일정을 확인해보세요.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-white p-3">
                <p className="text-sm font-semibold">공유 초대</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  공유 캘린더 초대 알림이 여기에 표시됩니다.
                </p>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {isImportantOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 px-0 md:items-center md:px-4">
          <section className="panel mobile-sheet w-full max-w-[520px] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">중요 일정</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsImportantOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              {importantEvents.length > 0 ? (
                importantEvents.map((item) => (
                  <button
                    key={item.id}
                    className="flex w-full gap-3 rounded-lg border border-[var(--line)] bg-white p-3 text-left"
                    onClick={() => {
                      setIsImportantOpen(false);
                      openEventDetail(item.id);
                    }}
                    type="button"
                  >
                    <Star size={17} className="mt-0.5 fill-[#f2b84b] text-[#b47818]" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {dateTimeFormatter.format(new Date(item.startsAt))}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <p className="rounded-lg border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
                  일정 상세에서 별을 눌러 중요 일정을 추가해보세요.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isDetailOpen && selectedEvent ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 px-0 md:items-center md:px-4">
          <section className="panel mobile-sheet w-full max-w-[520px] p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span
                  className={[
                    "mb-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                    selectedEvent.calendar.type === "PERSONAL"
                      ? "bg-[#e8f4ee] text-[#11623b]"
                      : "bg-[#eef1ff] text-[#2f4fb8]",
                  ].join(" ")}
                >
                  {selectedEvent.calendar.type === "PERSONAL" ? "내 캘린더" : "공유 캘린더"}
                </span>
                <h2 className="text-xl font-semibold leading-7">{selectedEvent.title}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className={[
                    "icon-button",
                    importantEventIds.includes(selectedEvent.id)
                      ? "border-[#f2d28c] bg-[#fff7e0] text-[#b47818]"
                      : "",
                  ].join(" ")}
                  aria-label="중요 일정"
                  onClick={() => toggleImportantEvent(selectedEvent.id)}
                  type="button"
                >
                  <Star
                    size={17}
                    className={
                      importantEventIds.includes(selectedEvent.id) ? "fill-[#f2b84b]" : ""
                    }
                  />
                </button>
                <button
                  className="icon-button"
                  aria-label="Close"
                  onClick={() => setIsDetailOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[var(--line)] bg-white p-4">
              <div>
                <p className="text-xs font-semibold text-[var(--muted)]">시간</p>
                <p className="mt-1 text-sm font-semibold">
                  {(selectedEvent.allDay ? dateFormatter : dateTimeFormatter).format(
                    new Date(selectedEvent.startsAt),
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  ~ {(selectedEvent.allDay ? dateFormatter : dateTimeFormatter).format(
                    new Date(selectedEvent.endsAt),
                  )}
                </p>
              </div>
              {selectedEvent.location ? (
                <div>
                  <p className="text-xs font-semibold text-[var(--muted)]">장소</p>
                  <p className="mt-1 text-sm font-semibold">{selectedEvent.location}</p>
                </div>
              ) : null}
              {selectedEvent.description ? (
                <div>
                  <p className="text-xs font-semibold text-[var(--muted)]">메모</p>
                  <p className="mt-1 text-sm leading-6 text-[#34362f]">
                    {selectedEvent.description}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold"
                onClick={openEditModal}
              >
                <Pencil size={16} />
                수정
              </button>
              <button className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold">
                <Share2 size={16} />
                공유
              </button>
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#f0c9d0] bg-[#fff7f8] text-sm font-semibold text-[#b93d53] disabled:opacity-50"
                disabled={isSaving}
                onClick={handleDeleteEvent}
              >
                <Trash2 size={16} />
                삭제
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isEditOpen && selectedEvent ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
          <section className="panel mobile-sheet w-full max-w-[460px] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">일정 수정</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setFormError(null);
                  setIsEditOpen(false);
                }}
              >
                ×
              </button>
            </div>
            <form className="space-y-3" onSubmit={handleUpdateEvent}>
              <input
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                defaultValue={selectedEvent.title}
                name="title"
                placeholder="일정 제목"
                required
              />
              <select
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                name="calendarId"
                required
                defaultValue={selectedEvent.calendarId}
              >
                {writableCalendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className="h-11 rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                  defaultValue={toInputValue(new Date(selectedEvent.startsAt))}
                  name="startsAt"
                  required
                  type="datetime-local"
                />
                <input
                  className="h-11 rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                  defaultValue={toInputValue(new Date(selectedEvent.endsAt))}
                  name="endsAt"
                  required
                  type="datetime-local"
                />
              </div>
              <input
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                defaultValue={selectedEvent.location ?? ""}
                name="location"
                placeholder="장소"
              />
              <textarea
                className="min-h-24 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[#aeb3a6]"
                defaultValue={selectedEvent.description ?? ""}
                name="description"
                placeholder="메모"
              />
              {formError ? (
                <p className="rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
                  {formError}
                </p>
              ) : null}
              <button
                className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSaving}
                type="submit"
              >
                {isSaving ? "수정 중" : "수정"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {isCreateOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
          <section className="panel mobile-sheet w-full max-w-[460px] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">새 일정</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setFormError(null);
                  setIsCreateOpen(false);
                }}
              >
                ×
              </button>
            </div>
            <form className="space-y-3" onSubmit={handleCreateEvent}>
              <input
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                name="title"
                placeholder="일정 제목"
                required
              />
              <select
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                name="calendarId"
                required
                defaultValue={writableCalendars[0]?.id}
              >
                {writableCalendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className="h-11 rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                  defaultValue={defaultStartsAt}
                  name="startsAt"
                  required
                  type="datetime-local"
                />
                <input
                  className="h-11 rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                  defaultValue={defaultEndsAt}
                  name="endsAt"
                  required
                  type="datetime-local"
                />
              </div>
              <input
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                name="location"
                placeholder="장소"
              />
              <textarea
                className="min-h-24 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[#aeb3a6]"
                name="description"
                placeholder="메모"
              />
              {formError ? (
                <p className="rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
                  {formError}
                </p>
              ) : null}
              <button
                className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSaving}
                type="submit"
              >
                {isSaving ? "저장 중" : "저장"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
