"use client";

import { type CSSProperties, type DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Bell,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  List,
  Moon,
  Pencil,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  Share2,
  Star,
  Sun,
  Trash2,
  UserPlus,
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
  description?: string | null;
  timezone?: string;
  isDefault?: boolean;
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
  isImportant: boolean;
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

type BottomView = "DAY" | "MONTH" | "IMPORTANT";
type CalendarView = "MONTH" | "WEEK" | "LIST";
type Theme = "light" | "dark";

type CalendarMember = {
  id: string;
  role: CalendarRole;
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
};

type CalendarSelectProps = {
  calendars: CalendarAppCalendar[];
  defaultValue?: string;
  name: string;
};

function CalendarSelect({ calendars, defaultValue, name }: CalendarSelectProps) {
  const initialValue =
    calendars.find((calendar) => calendar.id === defaultValue)?.id ?? calendars[0]?.id ?? "";
  const [value, setValue] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedCalendar = calendars.find((calendar) => calendar.id === value);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <input name={name} type="hidden" value={value} />
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`flex h-11 w-full items-center gap-3 rounded-lg border bg-white px-3 text-left text-sm outline-none transition-[border-color,box-shadow,background-color] hover:border-[#c9cbc2] focus-visible:border-[var(--ink)] focus-visible:ring-3 focus-visible:ring-black/10 ${
          isOpen ? "border-[var(--ink)] ring-3 ring-black/10" : "border-[var(--line)]"
        }`}
        disabled={calendars.length === 0}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setIsOpen(false);
        }}
        type="button"
      >
        {selectedCalendar ? (
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full ring-2 ring-black/5"
            style={{ backgroundColor: selectedCalendar.color }}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium">
          {selectedCalendar?.name ?? "캘린더를 선택하세요"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-[var(--muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div
          aria-label="캘린더 선택"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-56 overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-[0_16px_40px_rgba(24,25,22,0.16)]"
          role="listbox"
        >
          {calendars.map((calendar) => {
            const isSelected = calendar.id === value;

            return (
              <button
                aria-selected={isSelected}
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm transition-colors ${
                  isSelected ? "bg-[#f0efea] font-semibold" : "hover:bg-[#f7f6f2]"
                }`}
                key={calendar.id}
                onClick={() => {
                  setValue(calendar.id);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full ring-2 ring-black/5"
                  style={{ backgroundColor: calendar.color }}
                />
                <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                {isSelected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const weekDays = [
  { label: "일", tone: "text-[#d64f68]" },
  { label: "월", tone: "text-[var(--muted)]" },
  { label: "화", tone: "text-[var(--muted)]" },
  { label: "수", tone: "text-[var(--muted)]" },
  { label: "목", tone: "text-[var(--muted)]" },
  { label: "금", tone: "text-[var(--muted)]" },
  { label: "토", tone: "text-[#2f6bff]" },
];

const memberRoleLabels = {
  ADMIN: "관리",
  EDITOR: "편집",
  OWNER: "소유",
  VIEWER: "보기",
} satisfies Record<CalendarRole, string>;

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

function formatDayLabel(date: Date) {
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, "0")}. ${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function toInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  const end = startOfDay(date);
  end.setDate(end.getDate() + 1);
  return end;
}

function startOfWeek(date: Date) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function formatWeekLabel(date: Date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return `${start.getMonth() + 1}. ${start.getDate()} – ${end.getMonth() + 1}. ${end.getDate()}`;
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
  const [calendarItems, setCalendarItems] = useState(calendars);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState(() =>
    calendars.map((calendar) => calendar.id),
  );
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [eventItems, setEventItems] = useState(events);
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? "");
  const [bottomView, setBottomView] = useState<BottomView>("DAY");
  const [calendarView, setCalendarView] = useState<CalendarView>("MONTH");
  const [theme, setTheme] = useState<Theme>("light");
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const selectedYearRef = useRef<HTMLButtonElement>(null);
  const selectedMonthRef = useRef<HTMLButtonElement>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCalendarCreateOpen, setIsCalendarCreateOpen] = useState(false);
  const [editingCalendarId, setEditingCalendarId] = useState("");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteCalendarId, setInviteCalendarId] = useState("");
  const [inviteMembers, setInviteMembers] = useState<CalendarMember[]>([]);
  const [isLoadingInviteMembers, setIsLoadingInviteMembers] = useState(false);
  const [readNotificationKey, setReadNotificationKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [isPushSaving, setIsPushSaving] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("plandit-theme");
    const initialTheme: Theme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  useEffect(() => {
    if (!isMonthPickerOpen) return;

    window.requestAnimationFrame(() => {
      selectedYearRef.current?.scrollIntoView({ block: "center" });
      selectedMonthRef.current?.scrollIntoView({ block: "center" });
    });
  }, [isMonthPickerOpen]);

  useEffect(() => {
    function handleMonthPickerPointerDown(event: PointerEvent) {
      if (!monthPickerRef.current?.contains(event.target as Node)) {
        setIsMonthPickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleMonthPickerPointerDown);
    return () => document.removeEventListener("pointerdown", handleMonthPickerPointerDown);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (target?.matches("input, textarea, select") || target?.isContentEditable) {
        return;
      }

      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        openCreateModal();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        goToToday();
      } else if (event.key === "/") {
        event.preventDefault();
        openSearchModal();
      } else if (event.key === "Escape") {
        setIsCreateOpen(false);
        setIsDetailOpen(false);
        setIsEditOpen(false);
        setIsSearchOpen(false);
        setIsNotificationOpen(false);
        setIsMobileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

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

  const dailyEvents = useMemo(
    () =>
      visibleEvents
        .filter((event) => eventOverlapsDay(event, selectedDate))
        .slice()
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .slice(0, 8),
    [selectedDate, visibleEvents],
  );

  const monthRange = useMemo(() => {
    const rangeStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const rangeEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);

    return { rangeEnd, rangeStart };
  }, [month]);

  const monthlyEvents = useMemo(
    () =>
      visibleEvents
        .filter((event) =>
          eventOverlapsRange(event, monthRange.rangeStart, monthRange.rangeEnd),
        )
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [monthRange, visibleEvents],
  );

  const weekDates = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return date;
    });
  }, [selectedDate]);

  const weeklyEventsByDay = useMemo(
    () =>
      weekDates.map((date) => ({
        date,
        events: visibleEvents
          .filter((event) => eventOverlapsDay(event, date))
          .slice()
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
      })),
    [visibleEvents, weekDates],
  );

  const listEventGroups = useMemo(() => {
    const groups = new Map<number, CalendarAppEvent[]>();

    visibleEvents
      .slice()
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .forEach((event) => {
        const date = startOfDay(new Date(event.startsAt));
        const key = date.getTime();
        groups.set(key, [...(groups.get(key) ?? []), event]);
      });

    return Array.from(groups, ([timestamp, groupedEvents]) => ({
      date: new Date(timestamp),
      events: groupedEvents,
    }));
  }, [visibleEvents]);

  const importantEvents = useMemo(
    () =>
      eventItems
        .filter((event) => event.isImportant)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [eventItems],
  );
  const notificationEvents = useMemo(() => {
    const rangeStart = startOfDay(selectedDate);
    const rangeEnd = new Date(rangeStart);

    rangeEnd.setDate(rangeEnd.getDate() + 14);

    return visibleEvents
      .filter((event) => {
        const startsAt = new Date(event.startsAt);
        const endsAt = new Date(event.endsAt);

        return endsAt >= rangeStart && startsAt <= rangeEnd;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 8);
  }, [selectedDate, visibleEvents]);
  const notificationKey = useMemo(
    () =>
      notificationEvents
        .map((event) => `${event.id}:${event.startsAt}:${event.endsAt}`)
        .join("|"),
    [notificationEvents],
  );
  const hasUnreadNotifications =
    notificationEvents.length > 0 && notificationKey !== readNotificationKey;
  const searchedEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return [];
    }

    return visibleEvents
      .filter((event) =>
        [
          event.title,
          event.location ?? "",
          event.description ?? "",
          event.calendar.name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 20);
  }, [searchQuery, visibleEvents]);

  const writableCalendars = calendarItems.filter((calendar) =>
    ["OWNER", "ADMIN", "EDITOR"].includes(calendar.role),
  );
  const selectedInviteCalendar =
    calendarItems.find((calendar) => calendar.id === inviteCalendarId) ?? null;
  const isAllCalendarsSelected =
    calendarItems.length > 0 && selectedCalendarIds.length === calendarItems.length;
  const isSomeCalendarSelected = selectedCalendarIds.length > 0 && !isAllCalendarsSelected;

  function toggleCalendar(calendarId: string) {
    setSelectedCalendarIds((current) =>
      current.includes(calendarId)
        ? current.filter((id) => id !== calendarId)
        : [...current, calendarId],
    );
  }

  function toggleAllCalendars() {
    setSelectedCalendarIds((current) =>
      current.length === calendarItems.length
        ? []
        : calendarItems.map((calendar) => calendar.id),
    );
  }

  function openCreateModal() {
    setFormError(null);
    setIsCreateOpen(true);
  }

  function goToToday() {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
    setBottomView("DAY");
    setCalendarView("MONTH");
  }

  function changeDisplayedMonth(year: number, monthIndex: number) {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const nextSelectedDate = new Date(
      year,
      monthIndex,
      Math.min(selectedDate.getDate(), lastDay),
    );

    setMonth(new Date(year, monthIndex, 1));
    setSelectedDate(nextSelectedDate);
  }

  function selectCalendarDate(date: Date) {
    setSelectedDate(date);
    setBottomView("DAY");
  }

  function goToMainCalendar() {
    setIsMobileMenuOpen(false);
    setBottomView("DAY");
    setCalendarView("MONTH");
  }

  function openCalendarCreateModal() {
    setFormError(null);
    setIsCalendarCreateOpen(true);
  }

  function openSearchModal() {
    setIsSearchOpen(true);
  }

  function openSettingsModal() {
    setPushMessage("");
    setIsSettingsOpen(true);
  }

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("plandit-theme", nextTheme);
  }

  function openNotificationPanel() {
    setReadNotificationKey(notificationKey);
    setIsNotificationOpen(true);
  }

  function canInviteToCalendar(calendar: CalendarAppCalendar) {
    return ["OWNER", "ADMIN"].includes(calendar.role);
  }

  async function loadCalendarMembers(calendarId: string) {
    setIsLoadingInviteMembers(true);

    try {
      const response = await fetch(`/api/calendars/${calendarId}/members`);
      const result = (await response.json()) as {
        error?: string; message?: string;
        members?: CalendarMember[];
      };

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "멤버 목록을 불러오지 못했습니다.");
      }

      setInviteMembers(result.members ?? []);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
      setInviteMembers([]);
    } finally {
      setIsLoadingInviteMembers(false);
    }
  }

  function openInviteModal(calendarId: string) {
    setFormError(null);
    setInviteMessage("");
    setInviteUrl("");
    setInviteMembers([]);
    setInviteCalendarId(calendarId);
    setIsInviteOpen(true);
    void loadCalendarMembers(calendarId);
  }

  function openEventDetail(eventId: string) {
    setSelectedEventId(eventId);
    setShareMessage("");
    setShareUrl("");
    setIsDetailOpen(true);
  }

  function openSearchResult(event: CalendarAppEvent) {
    const eventDate = new Date(event.startsAt);

    setSelectedDate(startOfDay(eventDate));
    setMonth(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
    setBottomView("DAY");
    setIsSearchOpen(false);
    openEventDetail(event.id);
  }

  function openNotificationEvent(event: CalendarAppEvent) {
    const eventDate = new Date(event.startsAt);

    setSelectedDate(startOfDay(eventDate));
    setMonth(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
    setBottomView("DAY");
    setIsNotificationOpen(false);
    openEventDetail(event.id);
  }

  async function handleToggleImportantEvent() {
    if (!selectedEvent) {
      return;
    }

    setFormError(null);

    try {
      const response = await fetch(`/api/event-important/${selectedEvent.id}`, {
        method: "PATCH",
      });
      const result = (await response.json()) as {
        error?: string; message?: string;
        isImportant?: boolean;
      };

      if (!response.ok || typeof result.isImportant !== "boolean") {
        throw new Error(result.message ?? result.error ?? "중요 일정을 변경하지 못했습니다.");
      }

      const isImportant = result.isImportant;

      setEventItems((current) =>
        current.map((item) =>
          item.id === selectedEvent.id ? { ...item, isImportant } : item,
        ),
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    }
  }

  function openEditModal() {
    setFormError(null);
    setIsDetailOpen(false);
    setIsEditOpen(true);
  }

  function buildCalendarEvent(event: CalendarAppEvent, calendarId: string) {
    const calendar = calendarItems.find((item) => item.id === calendarId);

    return {
      ...event,
      color: event.color ?? calendar?.color ?? "var(--blue)",
      isImportant: event.isImportant ?? false,
      calendar: {
        id: calendar?.id ?? calendarId,
        name: calendar?.name ?? "내 캘린더",
        type: calendar?.type ?? "PERSONAL",
        color: calendar?.color ?? "var(--blue)",
      },
    } satisfies CalendarAppEvent;
  }

  function getMovedEventRange(event: CalendarAppEvent, targetDate: Date) {
    const startsAt = new Date(event.startsAt);
    const endsAt = new Date(event.endsAt);
    const duration = endsAt.getTime() - startsAt.getTime();
    const targetStart = new Date(targetDate);

    targetStart.setHours(
      startsAt.getHours(),
      startsAt.getMinutes(),
      startsAt.getSeconds(),
      startsAt.getMilliseconds(),
    );

    return {
      startsAt: targetStart,
      endsAt: new Date(targetStart.getTime() + duration),
    };
  }

  async function moveEventToDate(eventId: string, targetDate: Date) {
    const event = eventItems.find((item) => item.id === eventId);

    if (!event) {
      return;
    }

    const { endsAt, startsAt } = getMovedEventRange(event, targetDate);

    try {
      setIsSaving(true);
      setFormError(null);
      const response = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          calendarId: event.calendarId,
          description: event.description ?? "",
          endsAt: endsAt.toISOString(),
          location: event.location ?? "",
          startsAt: startsAt.toISOString(),
          title: event.title,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "일정을 이동하지 못했습니다.");
      }

      const movedEvent = buildCalendarEvent(
        {
          ...result.event,
          isImportant: event.isImportant,
        },
        result.event.calendarId,
      );

      setEventItems((current) =>
        current.map((item) => (item.id === movedEvent.id ? movedEvent : item)),
      );
      setSelectedDate(startOfDay(targetDate));
      setMonth(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleEventDragStart(dragEvent: DragEvent<HTMLElement>, eventId: string) {
    dragEvent.dataTransfer.setData("text/plain", eventId);
    dragEvent.dataTransfer.effectAllowed = "move";
  }

  function handleDayDragOver(dragEvent: DragEvent<HTMLButtonElement>) {
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = "move";
  }

  function handleDayDrop(dragEvent: DragEvent<HTMLButtonElement>, targetDate: Date) {
    dragEvent.preventDefault();

    const eventId = dragEvent.dataTransfer.getData("text/plain");

    if (!eventId) {
      return;
    }

    void moveEventToDate(eventId, targetDate);
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
      allDay: data.get("allDay") === "on",
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
        throw new Error(result.message ?? result.error ?? "일정을 저장하지 못했습니다.");
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

  async function handleCreateCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFormError(null);

    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/calendars", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          color: String(data.get("color")),
          name: String(data.get("name")),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "캘린더를 만들지 못했습니다.");
      }

      const createdCalendar = result.calendar as CalendarAppCalendar;

      setCalendarItems((current) => [...current, createdCalendar]);
      setSelectedCalendarIds((current) => [...current, createdCalendar.id]);
      setIsCalendarCreateOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const calendar = calendarItems.find((item) => item.id === editingCalendarId);
    if (!calendar) return;

    const data = new FormData(event.currentTarget);
    setIsSaving(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/calendars/${calendar.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name")),
          color: String(data.get("color")),
          description: String(data.get("description")) || undefined,
          timezone: String(data.get("timezone")),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "캘린더를 수정하지 못했습니다.");

      const updated = result.calendar as CalendarAppCalendar;
      setCalendarItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEventItems((current) => current.map((item) => item.calendarId === updated.id ? {
        ...item,
        color: item.color === item.calendar.color ? updated.color : item.color,
        calendar: { ...item.calendar, name: updated.name, color: updated.color },
      } : item));
      setEditingCalendarId("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteCalendar() {
    const calendar = calendarItems.find((item) => item.id === editingCalendarId);
    if (!calendar || calendar.isDefault || !window.confirm(`'${calendar.name}' 캘린더와 모든 일정을 삭제할까요?`)) return;

    setIsSaving(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/calendars/${calendar.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "캘린더를 삭제하지 못했습니다.");

      setCalendarItems((current) => current.filter((item) => item.id !== calendar.id));
      setSelectedCalendarIds((current) => current.filter((id) => id !== calendar.id));
      setEventItems((current) => current.filter((item) => item.calendarId !== calendar.id));
      setEditingCalendarId("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleInviteCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedInviteCalendar) {
      return;
    }

    setIsSaving(true);
    setFormError(null);
    setInviteMessage("");
    setInviteUrl("");

    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/calendars/${selectedInviteCalendar.id}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: String(data.get("email")),
          role: String(data.get("role")),
        }),
      });
      const result = (await response.json()) as {
        error?: string; message?: string;
        status?: "member" | "invited";
        url?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "초대를 처리하지 못했습니다.");
      }

      setInviteMessage(
        result.status === "member"
          ? "가입된 사용자를 캘린더 멤버로 추가했습니다."
          : "초대 링크가 생성되었습니다.",
      );
      setInviteUrl(result.url ?? "");
      setCalendarItems((current) =>
        current.map((calendar) =>
          calendar.id === selectedInviteCalendar.id
            ? { ...calendar, type: "SHARED" }
            : calendar,
        ),
      );
      if (result.status === "member") {
        void loadCalendarMembers(selectedInviteCalendar.id);
      }
      event.currentTarget.reset();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateCalendarMember(memberId: string, role: CalendarRole) {
    if (!selectedInviteCalendar) {
      return;
    }

    setFormError(null);

    try {
      const response = await fetch(
        `/api/calendars/${selectedInviteCalendar.id}/members/${memberId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role }),
        },
      );
      const result = (await response.json()) as {
        error?: string; message?: string;
        member?: CalendarMember;
      };

      if (!response.ok || !result.member) {
        throw new Error(result.message ?? result.error ?? "멤버 권한을 변경하지 못했습니다.");
      }

      setInviteMembers((current) =>
        current.map((member) => (member.id === result.member?.id ? result.member : member)),
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    }
  }

  async function handleRemoveCalendarMember(memberId: string) {
    if (!selectedInviteCalendar) {
      return;
    }

    setFormError(null);

    try {
      const response = await fetch(
        `/api/calendars/${selectedInviteCalendar.id}/members/${memberId}`,
        {
          method: "DELETE",
        },
      );
      const result = (await response.json()) as {
        error?: string; message?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "멤버를 내보내지 못했습니다.");
      }

      setInviteMembers((current) => current.filter((member) => member.id !== memberId));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
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
        throw new Error(result.message ?? result.error ?? "일정을 수정하지 못했습니다.");
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
        throw new Error(result.message ?? result.error ?? "일정을 삭제하지 못했습니다.");
      }

      setEventItems((current) => {
        const nextItems = current.filter((item) => item.id !== selectedEvent.id);
        setSelectedEventId(nextItems[0]?.id ?? "");
        return nextItems;
      });
      setIsEditOpen(false);
      setIsDetailOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleShareEvent() {
    if (!selectedEvent) {
      return;
    }

    setIsSharing(true);
    setShareMessage("");
    setFormError(null);

    try {
      const response = await fetch(`/api/event-shares/${selectedEvent.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "LINK",
          includeDescription: true,
          includeLocation: true,
        }),
      });
      const result = (await response.json()) as { error?: string; message?: string; url?: string };

      if (!response.ok || !result.url) {
        if (response.status === 404 || response.status === 403) {
          throw new Error("이 일정을 공유할 권한이 없습니다.");
        }

        throw new Error(result.message ?? result.error ?? "공유 링크를 생성하지 못했습니다.");
      }

      setShareUrl(result.url);

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.url);
        setShareMessage("공유 링크를 복사했습니다.");
      } else {
        setShareMessage("공유 링크를 생성했습니다.");
      }
    } catch (error) {
      setShareMessage("");
      setFormError(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSharing(false);
    }
  }

  async function handleRegisterPushChannel() {
    setIsPushSaving(true);
    setPushMessage("");

    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Web Push 공개 키가 설정되지 않았습니다.");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("이 브라우저는 푸시 알림을 지원하지 않습니다.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("알림 권한이 필요합니다.");

      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const serialized = subscription.toJSON();
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "WEB_PUSH",
          endpoint: subscription.endpoint,
          deviceName: "현재 브라우저",
          platform: "web",
          userAgent: navigator.userAgent,
          metadata: {
            auth: serialized.keys?.auth,
            p256dh: serialized.keys?.p256dh,
          },
        }),
      });
      const result = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "알림 채널을 등록하지 못했습니다.");
      }

      setPushMessage("이 브라우저의 실제 푸시 알림을 등록했습니다.");
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsPushSaving(false);
    }
  }

  async function handleSendTestPush() {
    setIsPushSaving(true);
    setPushMessage("");

    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Plandit",
          body: "Web Push 알림이 정상적으로 연결되었습니다.",
          url: "/",
        }),
      });
      const result = (await response.json()) as {
        error?: string; message?: string;
        failed?: number;
        sent?: number;
        total?: number;
      };

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "테스트 알림을 보내지 못했습니다.");
      }

      setPushMessage(
        `테스트 발송 기록: 성공 ${result.sent ?? 0}, 실패 ${result.failed ?? 0}, 전체 ${
          result.total ?? 0
        }`,
      );
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsPushSaving(false);
    }
  }

  const navigationPanel = (
    <>
      <button
        className="mb-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ink)] px-4 text-sm font-semibold text-white"
        onClick={() => {
          setIsMobileMenuOpen(false);
          openCreateModal();
        }}
        type="button"
      >
        <Plus size={17} />
        새 일정
      </button>

      <div>
        <div className="mb-3 flex items-center justify-between px-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              aria-label="모든 캘린더 선택"
              checked={isAllCalendarsSelected}
              className="size-4 accent-[var(--ink)]"
              onChange={toggleAllCalendars}
              ref={(input) => {
                if (input) input.indeterminate = isSomeCalendarSelected;
              }}
              type="checkbox"
            />
            <span className="text-xs font-semibold uppercase text-[var(--muted)]">
              캘린더 목록
            </span>
          </label>
          <button
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-transparent text-[var(--ink)] transition-colors hover:bg-[#e7e6e0]"
            aria-label="새 캘린더"
            onClick={() => {
              setIsMobileMenuOpen(false);
              openCalendarCreateModal();
            }}
            type="button"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="space-y-2">
          {calendarItems.map((calendar) => (
            <div
              key={calendar.id}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-[#efeee9]"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                <input
                  checked={selectedCalendarIds.includes(calendar.id)}
                  className="size-4 accent-[var(--ink)]"
                  onChange={() => toggleCalendar(calendar.id)}
                  type="checkbox"
                />
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: calendar.color }}
                />
                <span className="truncate text-[15px] font-medium text-[#34362f]">{calendar.name}</span>
              </label>
              {canInviteToCalendar(calendar) ? (
                <button
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-transparent text-[var(--muted)] transition-colors hover:bg-[#e7e6e0] hover:text-[var(--ink)]"
                  aria-label={`${calendar.name} 멤버`}
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openInviteModal(calendar.id);
                  }}
                  type="button"
                >
                  <UserPlus size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <button
        className="sticky bottom-0 mt-auto flex h-11 w-full shrink-0 items-center gap-3 rounded-lg bg-[#fdfcf9] px-3 text-sm font-semibold text-[#34362f] shadow-[0_-8px_20px_rgba(253,252,249,0.94)] hover:bg-[#e7e6e0]"
        onClick={() => {
          setIsMobileMenuOpen(false);
          openSettingsModal();
        }}
        type="button"
      >
        <Settings2 size={17} />
        설정
      </button>
    </>
  );

  const summaryEvents = bottomView === "DAY" ? dailyEvents : monthlyEvents;
  const summaryTitle =
    bottomView === "DAY" ? formatDayLabel(selectedDate) : formatMonthLabel(month);
  const SummaryIcon = bottomView === "DAY" ? Clock3 : List;
  const nextCalendarView: CalendarView =
    calendarView === "MONTH" ? "WEEK" : calendarView === "WEEK" ? "LIST" : "MONTH";
  const NextCalendarViewIcon =
    nextCalendarView === "WEEK" ? CalendarRange : nextCalendarView === "LIST" ? List : CalendarDays;
  const nextCalendarViewLabel =
    nextCalendarView === "WEEK" ? "주간 보기" : nextCalendarView === "LIST" ? "리스트 보기" : "월간 보기";

  const defaultStartDate = new Date(selectedDate);
  const now = new Date();
  const isSelectedToday = startOfDay(defaultStartDate).getTime() === startOfDay(now).getTime();

  if (isSelectedToday) {
    defaultStartDate.setHours(now.getHours(), now.getMinutes() < 30 ? 30 : 60, 0, 0);
  } else {
    defaultStartDate.setHours(9, 0, 0, 0);
  }

  const defaultEndDate = new Date(defaultStartDate.getTime() + 60 * 60 * 1000);
  const defaultStartsAt = toInputValue(defaultStartDate);
  const defaultEndsAt = toInputValue(defaultEndDate);

  return (
    <main className="app-shell bg-[var(--background)]">
      <div className="min-h-screen w-full bg-[var(--background)] pb-28">
        <section className="flex min-w-0 flex-col">
          <header className="flex items-center gap-3 bg-transparent px-3 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {bottomView === "IMPORTANT" ? (
                <div className="flex h-10 min-w-0 items-center gap-3">
                  <h1 className="truncate text-xl font-semibold leading-tight">
                    중요
                  </h1>
                  <span className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                    {importantEvents.length}
                  </span>
                </div>
              ) : (
                <div className="relative flex min-w-0 flex-1 items-center">
                  {calendarView === "MONTH" ? (
                    <>
                    <div className="relative" ref={monthPickerRef}>
                      <button
                        aria-expanded={isMonthPickerOpen}
                        aria-haspopup="dialog"
                        className="flex h-10 items-center gap-1.5 rounded-lg px-1 text-left text-xl font-semibold text-[var(--ink)] transition-colors hover:text-[var(--muted)]"
                        onClick={() => {
                          setPickerYear(month.getFullYear());
                          setIsMonthPickerOpen((open) => !open);
                        }}
                        type="button"
                      >
                        {month.getFullYear()}년 {month.getMonth() + 1}월
                        <ChevronDown
                          aria-hidden="true"
                          className={`size-4 text-[var(--muted)] transition-transform ${isMonthPickerOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      {isMonthPickerOpen ? (
                        <div
                          aria-label="연도와 월 선택"
                          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[280px] rounded-xl border border-[var(--line)] bg-white p-3 shadow-[0_18px_50px_rgba(24,25,22,0.18)]"
                          role="dialog"
                        >
                          <div className="mb-2 grid grid-cols-2 gap-2 px-1 text-center text-xs font-semibold text-[var(--muted)]">
                            <span>연도</span>
                            <span>월</span>
                          </div>
                          <div className="relative grid grid-cols-2 gap-2 overflow-hidden rounded-lg bg-transparent p-1.5">
                            <div aria-label="연도 선택" className="scrollbar-hide h-52 snap-y snap-mandatory overflow-y-auto py-20" role="listbox">
                              {Array.from({ length: 131 }, (_, index) => 1970 + index).map((year) => {
                                const isSelected = year === pickerYear;

                                return (
                                  <button
                                    aria-selected={isSelected}
                                    className={`flex h-11 w-full snap-center items-center justify-center rounded-lg text-sm transition-colors ${
                                      isSelected
                                        ? "font-semibold text-[var(--ink)]"
                                        : "text-[var(--muted)] hover:text-[var(--ink)]"
                                    }`}
                                    key={year}
                                    onClick={() => setPickerYear(year)}
                                    ref={isSelected ? selectedYearRef : undefined}
                                    role="option"
                                    type="button"
                                  >
                                    {year}년
                                  </button>
                                );
                              })}
                            </div>
                            <div aria-label="월 선택" className="scrollbar-hide h-52 snap-y snap-mandatory overflow-y-auto py-20" role="listbox">
                              {Array.from({ length: 12 }, (_, index) => {
                                const isSelected =
                                  pickerYear === month.getFullYear() && index === month.getMonth();

                                return (
                                  <button
                                    aria-selected={isSelected}
                                    className={`flex h-11 w-full snap-center items-center justify-center rounded-lg text-sm transition-colors ${
                                      isSelected
                                        ? "font-semibold text-[var(--ink)]"
                                        : "text-[var(--muted)] hover:text-[var(--ink)]"
                                    }`}
                                    key={index}
                                    onClick={() => {
                                      changeDisplayedMonth(pickerYear, index);
                                      setIsMonthPickerOpen(false);
                                    }}
                                    ref={isSelected ? selectedMonthRef : undefined}
                                    role="option"
                                    type="button"
                                  >
                                    {index + 1}월
                                  </button>
                                );
                              })}
                            </div>
                            <div aria-hidden="true" className="pointer-events-none absolute inset-x-1.5 top-1/2 h-11 -translate-y-1/2 rounded-lg border border-[var(--line)]" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    </>
                  ) : (
                    <h1 className="truncate text-center text-lg font-semibold leading-tight">
                      {calendarView === "WEEK" ? formatWeekLabel(selectedDate) : "전체 일정"}
                    </h1>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center">
              <button
                className="flex size-10 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]"
                aria-label="검색"
                title="검색"
                onClick={openSearchModal}
                type="button"
              >
                <Search size={19} />
              </button>
              <button
                className="relative flex size-10 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]"
                aria-label="알림"
                title="알림"
                onClick={openNotificationPanel}
                type="button"
              >
                <Bell size={18} />
                {hasUnreadNotifications ? (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#d64f68]" />
                ) : null}
              </button>
            </div>
          </header>

          {bottomView !== "IMPORTANT" && calendarItems.length > 0 ? (
            <div
              aria-label="표시할 캘린더"
              className="scrollbar-hide mx-3 mb-3 flex gap-2 overflow-x-auto px-0.5 pb-0.5 sm:mx-4"
            >
              {calendarItems.length > 1 ? (
                <button
                  aria-pressed={isAllCalendarsSelected}
                  className={`calendar-filter-chip flex h-8 shrink-0 items-center rounded-full border px-2.5 font-semibold transition-colors ${
                    isAllCalendarsSelected
                      ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                      : "border-transparent bg-[#e9e7e1] text-[var(--muted)] hover:bg-[#dfddd6]"
                  }`}
                  onClick={toggleAllCalendars}
                  style={{ fontSize: "13px", lineHeight: 1 }}
                  type="button"
                >
                  전체
                </button>
              ) : null}
              {calendarItems.map((calendar) => {
                const isSelected = selectedCalendarIds.includes(calendar.id);

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`calendar-filter-chip flex h-8 max-w-36 shrink-0 items-center gap-1 rounded-full border px-2.5 font-semibold transition-[border-color,background-color,color,box-shadow] ${
                      isSelected
                        ? "border-[#b9bbb2] bg-white text-[var(--ink)] shadow-sm"
                        : "border-transparent bg-[#e9e7e1] text-[var(--muted)] hover:bg-[#dfddd6]"
                    }`}
                    key={calendar.id}
                    onClick={() => toggleCalendar(calendar.id)}
                    style={{ fontSize: "13px", lineHeight: 1 }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${isSelected ? "" : "opacity-55"}`}
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className="truncate" style={{ fontSize: "13px", lineHeight: 1 }}>
                      {calendar.name}
                    </span>
                    {isSelected ? <Check aria-hidden="true" className="size-2.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-1 flex-col gap-4">
            {bottomView === "IMPORTANT" ? (
              <section className="min-w-0 overflow-hidden bg-transparent">
                <div className="divide-y divide-[var(--line)]">
                  {importantEvents.length > 0 ? (
                    importantEvents.map((item) => (
                      <button
                        key={item.id}
                        className={[
                          "flex w-full flex-col gap-2 bg-white px-4 py-4 text-left transition hover:bg-[#faf9f5]",
                          selectedEventId === item.id
                            ? "shadow-[inset_3px_0_0_#30322d]"
                            : "",
                        ].join(" ")}
                        onClick={() => openEventDetail(item.id)}
                        type="button"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <p className="truncate text-sm font-semibold">{item.title}</p>
                        </div>
                        <p className="truncate text-xs font-semibold text-[var(--muted)]">
                          {dateTimeFormatter.format(new Date(item.startsAt))}
                        </p>
                        <p className="truncate text-xs text-[var(--muted)]">
                          {item.calendar.name}
                        </p>
                      </button>
                    ))
                  ) : (
                    <p className="bg-white px-5 py-8 text-sm text-[var(--muted)]">
                      중요 일정으로 표시한 일정이 없습니다.
                    </p>
                  )}
                </div>
              </section>
            ) : calendarView === "WEEK" ? (
              <section className="min-w-0 overflow-hidden bg-transparent">
                <div className="divide-y divide-[var(--line)]">
                  {weeklyEventsByDay.map(({ date, events: dayEvents }) => {
                    const isToday = startOfDay(date).getTime() === startOfDay(new Date()).getTime();

                    return (
                      <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-3 px-3 py-3" key={date.toISOString()}>
                        <button
                          className="flex flex-col items-center rounded-lg py-1 text-center hover:bg-[#f3f1eb]"
                          onClick={() => setSelectedDate(date)}
                          type="button"
                        >
                          <span className="text-xs font-semibold text-[var(--muted)]">
                            {weekDays[date.getDay()]?.label}
                          </span>
                          <span className={`mt-1 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${isToday ? "bg-[var(--ink)] text-white" : "text-[var(--ink)]"}`}>
                            {date.getDate()}
                          </span>
                        </button>
                        <div className="min-w-0 space-y-2">
                          {dayEvents.length > 0 ? (
                            dayEvents.map((item) => (
                              <button
                                className="flex min-h-11 w-full items-center gap-3 rounded-lg bg-[#eeece6]/70 px-3 py-2 text-left hover:bg-[#e5e2db]"
                                key={`${date.toISOString()}-${item.id}`}
                                onClick={() => openEventDetail(item.id)}
                                type="button"
                              >
                                <span className="h-7 w-1 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                                  <span className="block text-xs text-[var(--muted)]">
                                    {item.allDay ? "하루 종일" : timeFormatter.format(new Date(item.startsAt))}
                                  </span>
                                </span>
                              </button>
                            ))
                          ) : (
                            <p className="py-3 text-sm text-[#a2a59b]">일정 없음</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : calendarView === "LIST" ? (
              <section className="space-y-3">
                {listEventGroups.length > 0 ? (
                  listEventGroups.map(({ date, events: groupedEvents }) => (
                    <div className="overflow-hidden bg-transparent" key={date.toISOString()}>
                      <div className="bg-[#eeece6]/70 px-4 py-3">
                        <h2 className="text-sm font-semibold">{dateFormatter.format(date)}</h2>
                      </div>
                      <div className="divide-y divide-[var(--line)]">
                        {groupedEvents.map((item) => (
                          <button
                            className="flex min-h-14 w-full items-center gap-3 bg-transparent px-4 py-3 text-left hover:bg-[#eeece6]/70"
                            key={item.id}
                            onClick={() => openEventDetail(item.id)}
                            type="button"
                          >
                            <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{item.title}</span>
                              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                                {item.allDay ? "하루 종일" : timeFormatter.format(new Date(item.startsAt))} · {item.calendar.name}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="panel p-6 text-center text-sm text-[var(--muted)]">
                    표시할 일정이 없습니다.
                  </div>
                )}
              </section>
            ) : (
            <div className="min-w-0 overflow-hidden bg-transparent">
              <div className="calendar-grid border-b border-[#eeeeec] bg-[#fafafa]">
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
                        className="day-cell bg-transparent text-left"
                        onClick={() => selectCalendarDate(day.date)}
                        onDoubleClick={openCreateModal}
                        onDragOver={handleDayDragOver}
                        onDrop={(dropEvent) => handleDayDrop(dropEvent, day.date)}
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
                              startOfDay(day.date).getTime() === startOfDay(selectedDate).getTime()
                                ? "bg-[var(--ink)] text-white"
                                : day.today
                                  ? "border border-[var(--ink)] text-[#30322d]"
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
                              draggable
                              onDragStart={(dragEvent) => handleEventDragStart(dragEvent, event.id)}
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
            )}

            {bottomView !== "IMPORTANT" && calendarView === "MONTH" ? (
            <section className="bg-transparent p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">{summaryTitle}</h2>
                <SummaryIcon size={18} className="text-[var(--muted)]" />
              </div>

              <div className="grid gap-3">
                {summaryEvents.length > 0 ? (
                  summaryEvents.map((item) => (
                    <button
                      key={item.id}
                      className={[
                        "flex w-full gap-3 rounded-lg p-3 text-left transition-colors",
                        selectedEventId === item.id
                          ? "bg-[#e5e2db]"
                          : "bg-[#eeece6]/70 hover:bg-[#e5e2db]",
                      ].join(" ")}
                      onClick={() => openEventDetail(item.id)}
                      type="button"
                    >
                      <div
                        className="mt-1 size-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          {bottomView === "DAY"
                            ? timeFormatter.format(new Date(item.startsAt))
                            : dateTimeFormatter.format(new Date(item.startsAt))}
                        </p>
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-[var(--muted)]">{item.calendar.name}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="rounded-lg bg-[#fafafa] p-3 text-sm text-[#858980]">
                    선택한 캘린더에 표시할 일정이 없습니다.
                  </p>
                )}
              </div>
            </section>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--panel)] px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(31,33,29,0.08)] backdrop-blur">
        <nav aria-label="주요 동작" className="mx-auto grid max-w-[360px] grid-cols-3 items-end gap-8">
          <button
            className="mx-auto flex size-14 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[#efeee9] hover:text-[var(--ink)]"
            aria-label={nextCalendarViewLabel}
            title={nextCalendarViewLabel}
            onClick={() => setCalendarView(nextCalendarView)}
            type="button"
          >
            <NextCalendarViewIcon size={23} />
          </button>
          <button
            className="mx-auto flex size-14 -translate-y-2 items-center justify-center rounded-full bg-[var(--action-bg)] text-[var(--action-fg)] shadow-[0_10px_24px_rgba(24,25,22,0.2)] ring-1 ring-[var(--line)] transition-colors"
            aria-label="새 일정"
            onClick={openCreateModal}
            type="button"
          >
            <Plus size={25} />
          </button>
          <button
            className="mx-auto flex size-14 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[#efeee9] hover:text-[var(--ink)]"
            aria-label="설정"
            title="설정"
            onClick={openSettingsModal}
            type="button"
          >
            <Settings2 size={22} />
          </button>
        </nav>
      </footer>

      {isMobileMenuOpen ? (
        <div
          className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/35"
          onClick={() => setIsMobileMenuOpen(false)}
          role="presentation"
        >
          <aside
            aria-label="캘린더 메뉴"
            className="mobile-drawer mobile-drawer-enter flex h-full w-[84vw] max-w-[320px] flex-col bg-[#fdfcf9] p-4 shadow-[24px_0_60px_rgba(31,33,29,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            {navigationPanel}
          </aside>
        </div>
      ) : null}

      {isNotificationOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/35">
          <aside className="mobile-drawer h-full w-[86vw] max-w-[360px] bg-[#fdfcf9] p-4 shadow-[-24px_0_60px_rgba(31,33,29,0.18)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">알림</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">다가오는 일정</p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsNotificationOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[calc(100vh-96px)] space-y-2 overflow-y-auto pr-1 scrollbar-hide">
              {notificationEvents.length > 0 ? (
                notificationEvents.map((item) => (
                  <button
                    key={item.id}
                    className="flex w-full gap-3 rounded-lg border border-[var(--line)] bg-white p-3 text-left hover:bg-[#faf9f5]"
                    onClick={() => openNotificationEvent(item)}
                    type="button"
                  >
                    <span
                      className="mt-1 size-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {item.title}
                      </span>
                      <span className="mt-1 block truncate text-xs font-semibold text-[var(--muted)]">
                        {dateTimeFormatter.format(new Date(item.startsAt))}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                        {item.calendar.name}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="rounded-lg border border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
                  앞으로 14일 안에 표시할 일정이 없습니다.
                </p>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {isSearchOpen ? (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 flex items-start justify-center bg-black/35 px-0">
          <section className="panel max-h-[calc(100vh-64px)] w-full max-w-[480px] overflow-y-auto rounded-t-none border-t-0 p-5 shadow-[0_24px_60px_rgba(31,33,29,0.2)] scrollbar-hide">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">검색</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsSearchOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <label className="flex h-12 items-center gap-3 rounded-lg border border-[var(--line)] bg-white px-3">
              <Search size={18} className="text-[var(--muted)]" />
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-[var(--muted)]"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="일정, 장소, 메모 검색"
                value={searchQuery}
              />
            </label>

            <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1 scrollbar-hide">
              {searchedEvents.length > 0 ? (
                searchedEvents.map((item) => (
                  <button
                    key={item.id}
                    className="flex w-full gap-3 rounded-lg border border-[var(--line)] bg-white p-3 text-left hover:bg-[#faf9f5]"
                    onClick={() => openSearchResult(item)}
                    type="button"
                  >
                    <span
                      className="mt-1 size-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {item.title}
                      </span>
                      <span className="mt-1 block truncate text-xs font-semibold text-[var(--muted)]">
                        {dateTimeFormatter.format(new Date(item.startsAt))}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                        {item.calendar.name}
                        {item.location ? ` · ${item.location}` : ""}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="rounded-lg border border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
                  {searchQuery.trim()
                    ? "검색 결과가 없습니다."
                    : "일정 제목, 장소 또는 메모를 입력해 검색하세요."}
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 px-0">
          <section className="panel mobile-sheet w-full max-w-[520px] p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">설정</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <section className="rounded-lg border border-[var(--line)] bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--muted)]">화면 테마</p>
                    <p className="mt-1 text-sm font-semibold">
                      {theme === "dark" ? "다크 모드" : "라이트 모드"}
                    </p>
                  </div>
                  <div className="flex rounded-lg bg-[var(--panel-soft)] p-1">
                    <button
                      aria-label="라이트 모드"
                      aria-pressed={theme === "light"}
                      className={`flex size-10 items-center justify-center rounded-md transition-colors ${theme === "light" ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--muted)]"}`}
                      onClick={() => changeTheme("light")}
                      type="button"
                    >
                      <Sun size={18} />
                    </button>
                    <button
                      aria-label="다크 모드"
                      aria-pressed={theme === "dark"}
                      className={`flex size-10 items-center justify-center rounded-md transition-colors ${theme === "dark" ? "bg-[var(--ink)] text-[var(--background)] shadow-sm" : "text-[var(--muted)]"}`}
                      onClick={() => changeTheme("dark")}
                      type="button"
                    >
                      <Moon size={18} />
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-white p-4">
                <p className="text-xs font-semibold text-[var(--muted)]">계정</p>
                <p className="mt-2 truncate text-sm font-semibold">{user.name}</p>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{user.email}</p>
              </section>

              <section className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[var(--line)] bg-white p-4">
                  <p className="text-xs font-semibold text-[var(--muted)]">캘린더</p>
                  <p className="mt-2 text-xl font-semibold">{calendarItems.length}</p>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-white p-4">
                  <p className="text-xs font-semibold text-[var(--muted)]">표시 중</p>
                  <p className="mt-2 text-xl font-semibold">{selectedCalendarIds.length}</p>
                </div>
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--muted)]">캘린더 관리</p>
                  <button className="text-xs font-semibold underline" onClick={openCalendarCreateModal} type="button">새 캘린더</button>
                </div>
                <div className="space-y-2">
                  {calendarItems.map((calendar) => (
                    <button
                      key={calendar.id}
                      className="flex w-full items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-left"
                      disabled={!(["OWNER", "ADMIN"] as CalendarRole[]).includes(calendar.role)}
                      onClick={() => { setFormError(null); setEditingCalendarId(calendar.id); }}
                      type="button"
                    >
                      <span className="size-3 rounded-full" style={{ backgroundColor: calendar.color }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{calendar.name}</span>
                      <Pencil size={14} className="text-[var(--muted)]" />
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--muted)]">시간대</p>
                    <p className="mt-2 text-sm font-semibold">Asia/Seoul</p>
                  </div>
                  <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                    ko-KR
                  </span>
                </div>
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--muted)]">푸시 알림</p>
                    <p className="mt-2 text-sm font-semibold">Provider: NOOP</p>
                  </div>
                  <Bell size={18} className="mt-1 text-[var(--muted)]" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    className="h-11 rounded-lg border border-[var(--line)] bg-[#f9f8f4] text-sm font-semibold disabled:opacity-50"
                    disabled={isPushSaving}
                    onClick={handleRegisterPushChannel}
                    type="button"
                  >
                    이 기기 등록
                  </button>
                  <button
                    className="h-11 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold disabled:opacity-50"
                    disabled={isPushSaving}
                    onClick={handleSendTestPush}
                    type="button"
                  >
                    테스트 발송
                  </button>
                </div>
                {pushMessage ? (
                  <p className="mt-3 rounded-lg bg-[#eff8f1] px-3 py-2 text-xs font-semibold text-[#11623b]">
                    {pushMessage}
                  </p>
                ) : null}
              </section>

              <button
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold text-[#34362f]"
                onClick={() => signOut({ callbackUrl: "/login" })}
                type="button"
              >
                <LogOut size={16} />
                로그아웃
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editingCalendarId && calendarItems.find((item) => item.id === editingCalendarId) ? (() => {
        const calendar = calendarItems.find((item) => item.id === editingCalendarId)!;
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
            <section className="panel mobile-sheet w-full max-w-[460px] p-5">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold">캘린더 설정</h2>
                <button className="icon-button" onClick={() => setEditingCalendarId("")} type="button"><X size={18} /></button>
              </div>
              <form className="space-y-3" onSubmit={handleUpdateCalendar}>
                <input className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3" defaultValue={calendar.name} name="name" required />
                <textarea className="min-h-24 w-full rounded-lg border border-[var(--line)] bg-white p-3" defaultValue={calendar.description ?? ""} name="description" placeholder="설명" />
                <input className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3" defaultValue={calendar.timezone ?? "Asia/Seoul"} name="timezone" required />
                <label className="flex h-11 items-center justify-between rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-semibold">색상<input className="size-8" defaultValue={calendar.color} name="color" type="color" /></label>
                {formError ? <p className="rounded-lg bg-[#fff3f1] px-3 py-2 text-sm text-[#b33a2f]">{formError}</p> : null}
                <button className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:opacity-50" disabled={isSaving} type="submit">저장</button>
                {!calendar.isDefault ? <button className="h-11 w-full rounded-lg border border-[#f0c9d0] bg-[#fff7f8] text-sm font-semibold text-[#b93d53] disabled:opacity-50" disabled={isSaving} onClick={() => void handleDeleteCalendar()} type="button">캘린더 삭제</button> : null}
              </form>
            </section>
          </div>
        );
      })() : null}

      {isInviteOpen && selectedInviteCalendar ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 px-0">
          <section className="panel mobile-sheet w-full max-w-[460px] p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">사용자 초대</h2>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">
                  {selectedInviteCalendar.name}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setFormError(null);
                  setInviteMessage("");
                  setInviteUrl("");
                  setIsInviteOpen(false);
                }}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <form className="space-y-3" onSubmit={handleInviteCalendar}>
              <input
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                name="email"
                placeholder="이메일"
                required
                type="email"
              />
              <select
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                defaultValue="VIEWER"
                name="role"
                required
              >
                <option value="VIEWER">보기만 가능</option>
                <option value="EDITOR">일정 편집 가능</option>
                <option value="ADMIN">캘린더 관리 가능</option>
              </select>
              {inviteMessage ? (
                <p className="rounded-lg bg-[#eff8f1] px-3 py-2 text-sm font-semibold text-[#11623b]">
                  {inviteMessage}
                </p>
              ) : null}
              {inviteUrl ? (
                <p className="break-all rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--muted)]">
                  {inviteUrl}
                </p>
              ) : null}
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
                {isSaving ? "초대 중" : "초대"}
              </button>
            </form>
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">멤버</h3>
                <span className="text-xs font-semibold text-[var(--muted)]">
                  {inviteMembers.length}
                </span>
              </div>
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1 scrollbar-hide">
                {isLoadingInviteMembers ? (
                  <p className="rounded-lg border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
                    불러오는 중입니다.
                  </p>
                ) : inviteMembers.length > 0 ? (
                  inviteMembers.map((member) => (
                    <div
                      key={member.id}
                      className="rounded-lg border border-[var(--line)] bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {member.user.name ?? member.user.email}
                          </p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">
                            {member.user.email}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                          {memberRoleLabels[member.role]}
                        </span>
                      </div>
                      {member.user.id !== user.id && member.role !== "OWNER" ? (
                        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                          <select
                            className="h-9 rounded-md border border-[var(--line)] bg-white px-2 text-xs font-semibold outline-none focus:border-[#aeb3a6]"
                            onChange={(event) =>
                              void handleUpdateCalendarMember(
                                member.id,
                                event.target.value as CalendarRole,
                              )
                            }
                            value={member.role}
                          >
                            <option value="VIEWER">보기</option>
                            <option value="EDITOR">편집</option>
                            <option value="ADMIN">관리</option>
                          </select>
                          <button
                            className="h-9 rounded-md border border-[#f0c9d0] bg-[#fff7f8] text-xs font-semibold text-[#b93d53]"
                            onClick={() => void handleRemoveCalendarMember(member.id)}
                            type="button"
                          >
                            내보내기
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
                    표시할 멤버가 없습니다.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isCalendarCreateOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-0">
          <section className="panel mobile-sheet w-full max-w-[460px] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">새 캘린더</h2>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setFormError(null);
                  setIsCalendarCreateOpen(false);
                }}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <form className="space-y-3" onSubmit={handleCreateCalendar}>
              <input
                className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
                name="name"
                placeholder="캘린더 이름"
                required
              />
              <label className="flex h-11 items-center justify-between rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-semibold">
                색상
                <input
                  className="size-8 rounded border-0 bg-transparent"
                  defaultValue="#2F6BFF"
                  name="color"
                  type="color"
                />
              </label>
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
                {isSaving ? "생성 중" : "생성"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {isDetailOpen && selectedEvent ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 px-0">
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
                    selectedEvent.isImportant
                      ? "border-[#f2d28c] bg-[#fff7e0] text-[#b47818]"
                      : "",
                  ].join(" ")}
                  aria-label="중요 일정"
                  onClick={handleToggleImportantEvent}
                  type="button"
                >
                  <Star
                    size={17}
                    className={selectedEvent.isImportant ? "fill-[#f2b84b]" : ""}
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
                type="button"
              >
                <Pencil size={16} />
                수정
              </button>
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold disabled:opacity-50"
                disabled={isSharing}
                onClick={handleShareEvent}
                type="button"
              >
                <Share2 size={16} />
                {isSharing ? "생성 중" : "공유"}
              </button>
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#f0c9d0] bg-[#fff7f8] text-sm font-semibold text-[#b93d53] disabled:opacity-50"
                disabled={isSaving}
                onClick={handleDeleteEvent}
                type="button"
              >
                <Trash2 size={16} />
                삭제
              </button>
            </div>

            {shareUrl || shareMessage ? (
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-white p-3">
                {shareMessage ? (
                  <p className="text-xs font-semibold text-[#11623b]">{shareMessage}</p>
                ) : null}
                {shareUrl ? (
                  <p className="mt-1 break-all text-xs text-[var(--muted)]">{shareUrl}</p>
                ) : null}
              </div>
            ) : null}

            {formError ? (
              <p className="mt-3 rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
                {formError}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {isEditOpen && selectedEvent ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-0">
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
              <CalendarSelect
                calendars={writableCalendars}
                defaultValue={selectedEvent.calendarId}
                key={selectedEvent.id}
                name="calendarId"
              />
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
              <label className="flex h-11 items-center gap-3 rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-semibold">
                <input defaultChecked={selectedEvent.allDay} name="allDay" type="checkbox" />
                하루 종일
              </label>
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
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 px-0">
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
              <CalendarSelect
                calendars={writableCalendars}
                defaultValue={writableCalendars[0]?.id}
                name="calendarId"
              />
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
              <label className="flex h-11 items-center gap-3 rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-semibold">
                <input name="allDay" type="checkbox" />
                하루 종일
              </label>
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
