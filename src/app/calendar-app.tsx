"use client";

import { FormEvent, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogOut,
  Plus,
  Search,
  Settings2,
  Share2,
  SquareStack,
  User,
  UserPlus,
  Users,
} from "lucide-react";

type CalendarScope = "ALL" | "PRIVATE" | "SHARED";
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

const weekDays = [
  { label: "일", tone: "text-[#d64f68]" },
  { label: "월", tone: "text-[var(--muted)]" },
  { label: "화", tone: "text-[var(--muted)]" },
  { label: "수", tone: "text-[var(--muted)]" },
  { label: "목", tone: "text-[var(--muted)]" },
  { label: "금", tone: "text-[var(--muted)]" },
  { label: "토", tone: "text-[#2f6bff]" },
];

const filterOptions: Array<{ label: string; value: CalendarScope }> = [
  { label: "전체", value: "ALL" },
  { label: "개인", value: "PRIVATE" },
  { label: "공유", value: "SHARED" },
];

const navItems = [
  ["오늘", CalendarDays],
  ["공유 캘린더", Share2],
  ["초대", Users],
] as const;

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

function buildMonthDays(month: Date, events: CalendarAppEvent[]) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: cells }, (_, index) => {
    const day = index - startOffset + 1;
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dateEnd = new Date(dateStart);
    dateEnd.setDate(dateEnd.getDate() + 1);
    const dayOfWeek = index % 7;

    return {
      key: date.toISOString(),
      date,
      label: date.getDate(),
      muted: day < 1 || day > daysInMonth,
      isSunday: dayOfWeek === 0,
      isSaturday: dayOfWeek === 6,
      isHoliday:
        month.getFullYear() === 2026 && month.getMonth() === 5 && day === 6,
      today:
        date.toDateString() === new Date().toDateString(),
      events: events.filter((event) => {
        const startsAt = new Date(event.startsAt);
        const endsAt = new Date(event.endsAt);

        return startsAt < dateEnd && endsAt > dateStart;
      }),
    };
  });
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

export default function CalendarApp({ calendars, events, user }: CalendarAppProps) {
  const [activeScope, setActiveScope] = useState<CalendarScope>("ALL");
  const [month, setMonth] = useState(() => new Date(2026, 5, 1));
  const [eventItems, setEventItems] = useState(events);
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? "");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filterIcons = {
    ALL: SquareStack,
    PRIVATE: User,
    SHARED: Users,
  } satisfies Record<CalendarScope, typeof SquareStack>;

  const visibleEvents = useMemo(
    () =>
      eventItems.filter((event) => {
        if (activeScope === "ALL") {
          return true;
        }

        return activeScope === "PRIVATE"
          ? event.calendar.type === "PERSONAL"
          : event.calendar.type === "SHARED";
      }),
    [activeScope, eventItems],
  );

  const monthDays = useMemo(
    () => buildMonthDays(month, visibleEvents),
    [month, visibleEvents],
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

  const writableCalendars = calendars.filter((calendar) =>
    ["OWNER", "ADMIN", "EDITOR"].includes(calendar.role),
  );

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const calendarId = String(data.get("calendarId"));
    const startsAt = new Date(String(data.get("startsAt")));
    const endsAt = new Date(String(data.get("endsAt")));

    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          calendarId,
          title: String(data.get("title")),
          description: String(data.get("description") ?? ""),
          location: String(data.get("location") ?? ""),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "일정을 저장하지 못했습니다.");
      }

      const calendar = calendars.find((item) => item.id === result.event.calendarId);
      const createdEvent: CalendarAppEvent = {
        ...result.event,
        startsAt: result.event.startsAt,
        endsAt: result.event.endsAt,
        color: result.event.color ?? calendar?.color ?? "var(--blue)",
        calendar: {
          id: calendar?.id ?? result.event.calendarId,
          name: calendar?.name ?? "Calendar",
          type: calendar?.type ?? "PERSONAL",
          color: calendar?.color ?? "var(--blue)",
        },
      };

      setEventItems((current) => [...current, createdEvent]);
      setSelectedEventId(createdEvent.id);
      setIsCreateOpen(false);
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
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-center bg-[var(--ink)] text-white md:hidden">
        <p className="mobile-brand-script text-[28px] leading-none">Plandit</p>
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] gap-4 px-4 pb-24 pt-[72px] md:pb-4 md:pt-4 lg:px-6">
        <aside className="hidden w-[272px] shrink-0 flex-col rounded-lg border border-[var(--line)] bg-[#fdfcf9] p-4 lg:flex">
          <div>
            <div className="mb-7 flex h-10 items-center justify-center">
              <p className="mobile-brand-script text-[30px] leading-none">Plandit</p>
            </div>

            <button
              className="mb-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ink)] px-4 text-sm font-semibold text-white"
              onClick={() => setIsCreateOpen(true)}
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
              <p className="mb-3 px-3 text-xs font-semibold uppercase text-[var(--muted)]">
                Calendars
              </p>
              <div className="space-y-2">
                {calendars.map((calendar) => (
                  <button
                    key={calendar.id}
                    className={[
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                      activeScope === (calendar.type === "PERSONAL" ? "PRIVATE" : "SHARED")
                        ? "bg-[#efeee9]"
                        : "",
                    ].join(" ")}
                    onClick={() =>
                      setActiveScope(calendar.type === "PERSONAL" ? "PRIVATE" : "SHARED")
                    }
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className="text-sm text-[#34362f]">{calendar.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[#fdfcf9] px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center justify-between gap-3 md:min-w-[220px] md:justify-start">
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
              <h1 className="min-w-[104px] flex-1 text-center text-xl font-semibold leading-tight md:flex-none sm:text-2xl">
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

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-[var(--line)] bg-white p-1">
                {filterOptions.map((option) => {
                  const Icon = filterIcons[option.value];

                  return (
                    <button
                      key={option.value}
                      aria-label={option.label}
                      className={[
                        "flex size-8 items-center justify-center rounded-md",
                        activeScope === option.value
                          ? "bg-[var(--ink)] text-white"
                          : "text-[#34362f] hover:bg-[#efeee9]",
                      ].join(" ")}
                      onClick={() => setActiveScope(option.value)}
                      title={option.label}
                    >
                      <Icon size={16} />
                    </button>
                  );
                })}
              </div>
              <div className="hidden h-10 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 md:flex">
                <Search size={16} className="text-[var(--muted)]" />
                <input
                  className="w-48 bg-transparent text-sm outline-none"
                  placeholder="일정 검색"
                />
              </div>
              <button className="icon-button hidden md:inline-flex" aria-label="Notifications" title="Notifications">
                <Bell size={18} />
              </button>
              <button className="icon-button hidden md:inline-flex" aria-label="Settings" title="Settings">
                <Settings2 size={18} />
              </button>
              <button
                className="icon-button hidden md:inline-flex"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>

          <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
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
              <div className="calendar-grid">
                {monthDays.map((day) => (
                  <button
                    key={day.key}
                    className="day-cell bg-white/70 text-left"
                    onDoubleClick={() => setIsCreateOpen(true)}
                  >
                    <div className="mb-2 flex items-center justify-between">
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
                    <div className="space-y-1.5">
                      {day.events.map((event) => (
                        <span
                          key={`${event.id}-${day.key}`}
                          className={getEventPillClass(event, day.date)}
                          style={{ backgroundColor: event.color }}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            setSelectedEventId(event.id);
                          }}
                        >
                          {event.title}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">오늘</h2>
                  <Clock3 size={18} className="text-[var(--muted)]" />
                </div>
                <div className="space-y-3">
                  {agenda.length > 0 ? (
                    agenda.map((item) => (
                      <button
                        key={item.id}
                        className={[
                          "flex w-full gap-3 rounded-lg border bg-white p-3 text-left",
                          selectedEvent?.id === item.id
                            ? "border-[#9fa598]"
                            : "border-[var(--line)]",
                        ].join(" ")}
                        onClick={() => setSelectedEventId(item.id)}
                      >
                        <div
                          className="mt-1 size-2.5 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--muted)]">
                            {new Intl.DateTimeFormat("ko-KR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(item.startsAt))}
                          </p>
                          <p className="truncate text-sm font-semibold">{item.title}</p>
                          <p className="text-xs text-[var(--muted)]">{item.calendar.name}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-lg border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
                      표시할 일정이 없습니다.
                    </p>
                  )}
                </div>
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">일정 상세</h2>
                  {selectedEvent ? (
                    <span
                      className={[
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        selectedEvent.calendar.type === "PERSONAL"
                          ? "bg-[#e8f4ee] text-[#11623b]"
                          : "bg-[#eef1ff] text-[#2f4fb8]",
                      ].join(" ")}
                    >
                      {selectedEvent.calendar.type === "PERSONAL" ? "Private" : "Shared"}
                    </span>
                  ) : null}
                </div>
                {selectedEvent ? (
                  <div className="rounded-lg border border-[var(--line)] bg-white p-3">
                    <p className="text-sm font-semibold">{selectedEvent.title}</p>
                    <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                      {new Intl.DateTimeFormat("ko-KR", {
                        dateStyle: "medium",
                        timeStyle: selectedEvent.allDay ? undefined : "short",
                      }).format(new Date(selectedEvent.startsAt))}
                    </p>
                    {selectedEvent.description ? (
                      <p className="mt-3 text-sm leading-6 text-[#34362f]">
                        {selectedEvent.description}
                      </p>
                    ) : null}
                    {selectedEvent.location ? (
                      <p className="mt-3 text-xs font-semibold text-[var(--muted)]">
                        {selectedEvent.location}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-lg border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
                    일정을 선택하거나 새 일정을 만들어보세요.
                  </p>
                )}
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">공유</h2>
                  <Share2 size={18} className="text-[var(--muted)]" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">공유 캘린더</p>
                    <p className="text-xs text-[var(--muted)]">
                      멤버 초대 기능이 다음 단계로 연결됩니다.
                    </p>
                  </div>
                  <button className="flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-semibold">
                    <Users size={16} />
                    초대
                  </button>
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[#fdfcf9]/95 px-3 py-2 shadow-[0_-12px_40px_rgba(31,33,29,0.08)] backdrop-blur md:hidden">
        <nav className="mx-auto grid max-w-[520px] grid-cols-5 gap-1">
          {[
            ["오늘", CalendarDays],
            ["공유", Share2],
            ["초대", UserPlus],
            ["알림", Bell],
            ["설정", Settings2],
          ].map(([label, Icon]) => (
            <button
              key={label as string}
              className="flex h-14 items-center justify-center rounded-lg text-[#34362f] hover:bg-[#efeee9]"
              aria-label={label as string}
              title={label as string}
            >
              <Icon size={21} />
            </button>
          ))}
        </nav>
      </footer>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <section className="panel w-full max-w-[460px] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">새 일정</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsCreateOpen(false)}
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
              <div className="grid grid-cols-2 gap-2">
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
