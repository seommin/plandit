"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Link2,
  Lock,
  MessageCircle,
  MonitorSmartphone,
  Plus,
  Search,
  Settings2,
  Share2,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";

type CalendarScope = "ALL" | "PRIVATE" | "SHARED";

type DemoEvent = {
  id: string;
  title: string;
  color: string;
  scope: Exclude<CalendarScope, "ALL">;
  meta: string;
  time?: string;
  description: string;
  location?: string;
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

const eventByDay = new Map<number, DemoEvent[]>([
  [
    9,
    [
      {
        id: "brand-launch",
        title: "브랜드 런칭 플랜",
        color: "var(--blue)",
        scope: "SHARED",
        meta: "Plandit Team",
        time: "09:30",
        description: "브랜드 런칭 전까지 제품 메시지, 공유 권한, 공개 일정 링크를 정리합니다.",
        location: "Plandit HQ",
      },
      {
        id: "private-workout",
        title: "개인 운동",
        color: "var(--green)",
        scope: "PRIVATE",
        meta: "나만 보기",
        time: "19:30",
        description: "공유 캘린더에는 노출되지 않는 개인 일정입니다.",
      },
    ],
  ],
  [
    10,
    [
      {
        id: "google-sync",
        title: "Google Calendar sync",
        color: "var(--green)",
        scope: "PRIVATE",
        meta: "개인 연동",
        time: "14:20",
        description: "Google Calendar API 연동 범위와 동기화 토큰 저장 방식을 점검합니다.",
      },
    ],
  ],
  [
    12,
    [
      {
        id: "permission-qa",
        title: "공유 권한 QA",
        color: "var(--violet)",
        scope: "SHARED",
        meta: "초대 4명",
        time: "11:00",
        description: "공유 캘린더의 owner/admin/editor/viewer 권한 흐름을 확인합니다.",
      },
    ],
  ],
  [
    16,
    [
      {
        id: "widget-prototype",
        title: "위젯 프로토타입",
        color: "var(--amber)",
        scope: "SHARED",
        meta: "Launch",
        time: "16:00",
        description: "홈/잠금화면 위젯에 표시할 오늘 일정 요약을 설계합니다.",
      },
    ],
  ],
]);

const monthDays = Array.from({ length: 35 }, (_, index) => {
  const day = index - 1;
  const dayOfWeek = index % 7;

  return {
    key: `${day}-${index}`,
    label: day < 1 ? 27 + index : day > 30 ? day - 30 : day,
    day,
    muted: day < 1 || day > 30,
    isSunday: dayOfWeek === 0,
    isSaturday: dayOfWeek === 6,
    isHoliday: day === 6,
    today: day === 9,
    events: eventByDay.get(day) ?? [],
  };
});

const filterOptions: Array<{ label: string; value: CalendarScope }> = [
  { label: "All", value: "ALL" },
  { label: "Private", value: "PRIVATE" },
  { label: "Shared", value: "SHARED" },
];

const collaborators = ["YU", "MK", "HN", "JL"];

const quickShareActions = [
  { label: "KakaoTalk", icon: MessageCircle },
  { label: "Copy link", icon: Link2 },
] as const;

const navItems = [
  ["오늘", CalendarDays],
  ["공유 캘린더", Share2],
  ["초대", Users],
  ["연동", Link2],
  ["위젯", MonitorSmartphone],
] as const;

const calendarItems = [
  { label: "Private", color: "var(--green)", scope: "PRIVATE" },
  { label: "Plandit Team", color: "var(--blue)", scope: "SHARED" },
  { label: "Launch", color: "var(--rose)", scope: "SHARED" },
] as const;

export default function Home() {
  const [activeScope, setActiveScope] = useState<CalendarScope>("ALL");
  const [selectedEventId, setSelectedEventId] = useState("brand-launch");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  const filteredMonthDays = useMemo(
    () =>
      monthDays.map((day) => ({
        ...day,
        events:
          activeScope === "ALL"
            ? day.events
            : day.events.filter((event) => event.scope === activeScope),
      })),
    [activeScope],
  );

  const agenda = useMemo(
    () =>
      filteredMonthDays
        .flatMap((day) => day.events)
        .filter((event) => event.time)
        .slice(0, 4),
    [filteredMonthDays],
  );

  const selectedEvent = useMemo(() => {
    const events = monthDays.flatMap((day) => day.events);

    return (
      events.find((event) => event.id === selectedEventId) ??
      events.find((event) => activeScope === "ALL" || event.scope === activeScope) ??
      events[0]
    );
  }, [activeScope, selectedEventId]);

  async function handleShare(channel: "KakaoTalk" | "Copy link") {
    const shareUrl = `${window.location.origin}/s/demo-${selectedEvent.id}`;

    if (channel === "Copy link") {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("링크를 복사했습니다.");
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setShareStatus("카톡 공유용 링크를 복사했습니다.");
  }

  return (
    <main className="app-shell">
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-center bg-[var(--ink)] text-white md:hidden">
        <p className="mobile-brand-script text-[28px] leading-none">Plandit</p>
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] gap-4 px-4 pb-24 pt-[72px] md:pb-4 md:pt-4 lg:px-6">
        <aside className="hidden w-[272px] shrink-0 flex-col justify-between rounded-lg border border-[var(--line)] bg-[#fdfcf9] p-4 lg:flex">
          <div>
            <div className="mb-7 flex h-10 items-center justify-center">
              <p className="mobile-brand-script text-[30px] leading-none">Plandit</p>
            </div>

            <button className="mb-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--ink)] px-4 text-sm font-semibold text-white">
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
                {calendarItems.map((item) => (
                  <button
                    key={item.label}
                    className={[
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                      activeScope === item.scope ? "bg-[#efeee9]" : "",
                    ].join(" ")}
                    onClick={() => setActiveScope(item.scope)}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-[#34362f]">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={16} />
              Modern stack
            </div>
            <p className="text-xs leading-5 text-[var(--muted)]">
              Next.js 16, Prisma 7, PostgreSQL 18, Auth.js 5 beta.
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[#fdfcf9] px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center justify-between gap-3 md:min-w-[220px] md:justify-start">
              <button className="icon-button" aria-label="Previous month" title="Previous month">
                <ChevronLeft size={18} />
              </button>
              <h1 className="min-w-[104px] flex-1 text-center text-xl font-semibold leading-tight md:flex-none sm:text-2xl">
                2026. 06
              </h1>
              <button className="icon-button" aria-label="Next month" title="Next month">
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-[var(--line)] bg-white p-1">
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={[
                      "h-8 rounded-md px-3 text-xs font-semibold",
                      activeScope === option.value
                        ? "bg-[var(--ink)] text-white"
                        : "text-[#34362f] hover:bg-[#efeee9]",
                    ].join(" ")}
                    onClick={() => setActiveScope(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
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
                {filteredMonthDays.map((day) => (
                  <div key={day.key} className="day-cell bg-white/70">
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={[
                          "flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                          day.muted ? "text-[#a2a59b]" : "text-[#30322d]",
                          !day.muted && (day.isSunday || day.isHoliday)
                            ? "text-[#d64f68]"
                            : "",
                          !day.muted && day.isSaturday ? "text-[#2f6bff]" : "",
                          day.today ? "bg-[var(--ink)] text-white" : "",
                        ].join(" ")}
                      >
                        {day.label}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {day.events.map((event) => (
                        <button
                          key={event.title}
                          className="event-pill text-left"
                          style={{ backgroundColor: event.color }}
                          onClick={() => {
                            setSelectedEventId(event.id);
                            setShareStatus(null);
                          }}
                        >
                          {event.title}
                        </button>
                      ))}
                    </div>
                  </div>
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
                  {agenda.map((item) => (
                    <button
                      key={item.title}
                      className={[
                        "flex w-full gap-3 rounded-lg border bg-white p-3 text-left",
                        selectedEvent.id === item.id
                          ? "border-[#9fa598]"
                          : "border-[var(--line)]",
                      ].join(" ")}
                      onClick={() => {
                        setSelectedEventId(item.id);
                        setShareStatus(null);
                      }}
                    >
                      <div
                        className="mt-1 size-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          {item.time}
                        </p>
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-[var(--muted)]">{item.meta}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">일정 상세</h2>
                  <span
                    className={[
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      selectedEvent.scope === "PRIVATE"
                        ? "bg-[#e8f4ee] text-[#11623b]"
                        : "bg-[#eef1ff] text-[#2f4fb8]",
                    ].join(" ")}
                  >
                    {selectedEvent.scope === "PRIVATE" ? "Private" : "Shared"}
                  </span>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-white p-3">
                  <p className="text-sm font-semibold">{selectedEvent.title}</p>
                  <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                    {selectedEvent.time} · {selectedEvent.meta}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[#34362f]">
                    {selectedEvent.description}
                  </p>
                  {selectedEvent.location ? (
                    <p className="mt-3 text-xs font-semibold text-[var(--muted)]">
                      {selectedEvent.location}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">공유</h2>
                  <Share2 size={18} className="text-[var(--muted)]" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {collaborators.map((item) => (
                      <div
                        key={item}
                        className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-[var(--panel-soft)] text-xs font-bold"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                  <button className="flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-semibold">
                    <Users size={16} />
                    초대
                  </button>
                </div>
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Quick share</h2>
                  <Link2 size={18} className="text-[var(--muted)]" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {quickShareActions.map(({ label, icon: Icon }) => (
                    <button
                      key={label}
                      className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold"
                      onClick={() => handleShare(label)}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  Share one event without exposing your private calendar.
                </p>
                {shareStatus ? (
                  <p className="mt-2 text-xs font-semibold text-[#11623b]">
                    {shareStatus}
                  </p>
                ) : null}
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">연동</h2>
                  <Link2 size={18} className="text-[var(--muted)]" />
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">Google Calendar</p>
                    <span className="rounded-full bg-[#e8f4ee] px-2 py-1 text-xs font-semibold text-[#11623b]">
                      Ready
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-[var(--muted)]">
                    OAuth 계정과 캘린더 동기화 토큰 모델이 준비되었습니다.
                  </p>
                </div>
              </section>

              <section className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">위젯</h2>
                  <MonitorSmartphone size={18} className="text-[var(--muted)]" />
                </div>
                <div className="rounded-[26px] border border-[#24251f] bg-[#1f211c] p-3 text-white">
                  <div className="rounded-[20px] bg-[#30332c] p-4">
                    <div className="mb-5 flex items-center justify-between">
                      <p className="text-sm font-semibold">Today</p>
                      <Lock size={15} />
                    </div>
                    <p className="text-2xl font-semibold">09:30</p>
                    <p className="mt-1 text-sm text-[#c8ccc0]">
                      브랜드 런칭 플랜
                    </p>
                  </div>
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
    </main>
  );
}
