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

const weekDays = [
  { label: "일", tone: "text-[#d64f68]" },
  { label: "월", tone: "text-[var(--muted)]" },
  { label: "화", tone: "text-[var(--muted)]" },
  { label: "수", tone: "text-[var(--muted)]" },
  { label: "목", tone: "text-[var(--muted)]" },
  { label: "금", tone: "text-[var(--muted)]" },
  { label: "토", tone: "text-[#2f6bff]" },
];

const monthDays = Array.from({ length: 35 }, (_, index) => {
  const day = index - 1;
  const dayOfWeek = index % 7;
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;
  const isHoliday = day === 6;

  return {
    label: day < 1 ? 27 + index : day > 30 ? day - 30 : day,
    muted: day < 1 || day > 30,
    isSunday,
    isSaturday,
    isHoliday,
    today: day === 9,
    events:
      day === 9
        ? [
            { title: "브랜드 런칭 플랜", color: "var(--blue)" },
            { title: "디자인 리뷰", color: "var(--rose)" },
          ]
        : day === 10
          ? [{ title: "Google Calendar sync", color: "var(--green)" }]
          : day === 12
            ? [{ title: "공유 권한 QA", color: "var(--violet)" }]
            : day === 16
              ? [{ title: "위젯 프로토타입", color: "var(--amber)" }]
              : [],
  };
});

const agenda = [
  {
    time: "09:30",
    title: "브랜드 런칭 플랜",
    meta: "Plandit Team",
    color: "bg-[#2f6bff]",
  },
  {
    time: "11:00",
    title: "디자인 리뷰",
    meta: "초대 4명",
    color: "bg-[#d64f68]",
  },
  {
    time: "14:20",
    title: "구글 캘린더 연동",
    meta: "OAuth scope",
    color: "bg-[#198754]",
  },
];

const collaborators = ["YU", "MK", "HN", "JL"];

const quickShareActions = [
  { label: "KakaoTalk", icon: MessageCircle },
  { label: "Copy link", icon: Link2 },
];

export default function Home() {
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
              {[
                ["오늘", CalendarDays],
                ["공유 캘린더", Share2],
                ["초대", Users],
                ["연동", Link2],
                ["위젯", MonitorSmartphone],
              ].map(([label, Icon]) => (
                <button
                  key={label as string}
                  className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[#34362f] hover:bg-[#efeee9]"
                >
                  <Icon size={17} />
                  {label as string}
                </button>
              ))}
            </nav>

            <div className="mt-8">
              <p className="mb-3 px-3 text-xs font-semibold uppercase text-[var(--muted)]">
                Calendars
              </p>
              <div className="space-y-2">
                {[
                  ["Plandit Team", "var(--blue)"],
                  ["Personal", "var(--green)"],
                  ["Launch", "var(--rose)"],
                ].map(([label, color]) => (
                  <div key={label} className="flex items-center gap-3 rounded-lg px-3 py-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm text-[#34362f]">{label}</span>
                  </div>
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
              <button className="icon-button hidden md:inline-flex" aria-label="Open calendar" title="Open calendar">
                <CalendarDays size={18} />
              </button>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <div className="hidden h-10 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 md:flex">
                <Search size={16} className="text-[var(--muted)]" />
                <input
                  className="w-48 bg-transparent text-sm outline-none"
                  placeholder="일정 검색"
                />
              </div>
              <button className="icon-button" aria-label="Notifications" title="Notifications">
                <Bell size={18} />
              </button>
              <button className="icon-button" aria-label="Settings" title="Settings">
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
                {monthDays.map((day, index) => (
                  <div key={`${day.label}-${index}`} className="day-cell bg-white/70">
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={[
                          "flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                          day.muted ? "text-[#a2a59b]" : "text-[#30322d]",
                          !day.muted && (day.isSunday || day.isHoliday) ? "text-[#d64f68]" : "",
                          !day.muted && day.isSaturday ? "text-[#2f6bff]" : "",
                          day.today ? "bg-[var(--ink)] text-white" : "",
                        ].join(" ")}
                      >
                        {day.label}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {day.events.map((event) => (
                        <div
                          key={event.title}
                          className="event-pill"
                          style={{ backgroundColor: event.color }}
                        >
                          {event.title}
                        </div>
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
                    <div key={item.title} className="flex gap-3 rounded-lg border border-[var(--line)] bg-white p-3">
                      <div className={`mt-1 size-2.5 rounded-full ${item.color}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--muted)]">{item.time}</p>
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-[var(--muted)]">{item.meta}</p>
                      </div>
                    </div>
                  ))}
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
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  Share one event without exposing your private calendar.
                </p>
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
                    <p className="mt-1 text-sm text-[#c8ccc0]">브랜드 런칭 플랜</p>
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
