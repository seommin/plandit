"use client";

import { ListTodo, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { EventRow } from "@/components/event-row";
import { type EditorState, EventEditor } from "@/components/event-editor";
import { EmptyState, Notice, Tabs } from "@/components/ui";
import { useCalendarState } from "@/components/use-calendar-state";
import { addDays, byStart, formatMonthDay, isSameDay, startOfDay } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

type Tab = "upcoming" | "important" | "past";

/** Everything from 60 days back to 180 days ahead, grouped by day. */
export default function AgendaPage() {
  const [range] = useState(() => {
    const today = startOfDay(new Date());
    return { from: addDays(today, -60), to: addDays(today, 180) };
  });
  const { calendars, events, upsertEvent, removeEvent, loading, error } = useCalendarState(range.from, range.to);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });

  const groups = useMemo(() => {
    const now = new Date();
    const q = query.trim().toLowerCase();
    const matches = (e: CalendarEvent) =>
      !q || [e.title, e.location ?? "", e.description ?? "", e.calendar.name].join(" ").toLowerCase().includes(q);

    const list = events
      .filter(matches)
      .filter((e) => (tab === "important" ? e.isImportant : tab === "past" ? new Date(e.endsAt) <= now : new Date(e.endsAt) > now))
      .sort(byStart);
    if (tab === "past") list.reverse();

    const byDay = new Map<number, CalendarEvent[]>();
    for (const event of list) {
      const day = startOfDay(new Date(Math.max(new Date(event.startsAt).getTime(), tab === "upcoming" ? startOfDay(now).getTime() : 0))).getTime();
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
    return [...byDay].map(([day, items]) => ({ day: new Date(day), items }));
  }, [events, tab, query]);

  const dayLabel = (day: Date) => {
    const today = new Date();
    if (isSameDay(day, today)) return `오늘 · ${formatMonthDay(day)}`;
    if (isSameDay(day, addDays(today, 1))) return `내일 · ${formatMonthDay(day)}`;
    return formatMonthDay(day);
  };

  return (
    <div className="mx-auto max-w-2xl px-3 lg:px-8">
      <header className="sticky top-0 z-30 -mx-3 space-y-3 bg-bg/90 px-3 pb-3 pt-3 backdrop-blur lg:static lg:mx-0 lg:px-0 lg:pt-7">
        <h1 className="px-1 text-[21px] font-bold tracking-tight lg:text-2xl">일정</h1>
        <label className="flex h-11 items-center gap-2.5 rounded-xl bg-surface-2 px-3.5">
          <Search className="shrink-0 text-fg-3" size={18} />
          <input
            aria-label="일정 검색"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목, 장소, 메모로 검색"
            type="search"
            value={query}
          />
        </label>
        <Tabs
          label="일정 보기"
          onChange={setTab}
          options={[
            { value: "upcoming", label: "다가오는" },
            { value: "important", label: "중요" },
            { value: "past", label: "지난 일정" },
          ]}
          value={tab}
        />
      </header>

      {error ? <Notice>{error}</Notice> : null}

      {loading && !events.length ? (
        <p className="py-10 text-center text-sm text-fg-3">불러오는 중…</p>
      ) : groups.length ? (
        <div className="space-y-4 pb-6">
          {groups.map(({ day, items }) => (
            <section key={day.toISOString()}>
              <h2 className="mb-2 px-1 text-[13px] font-semibold text-fg-3">{dayLabel(day)}</h2>
              <div>
                {items.map((event) => (
                  <EventRow event={event} key={event.id} onOpen={(e) => setEditor({ mode: "edit", event: e })} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-2">
          <EmptyState
            description={query ? "다른 검색어로 찾아보세요." : tab === "important" ? "일정을 열고 ★를 누르면 여기에 모여요." : undefined}
            icon={tab === "important" ? <Star size={22} /> : <ListTodo size={22} />}
            title={query ? "검색 결과가 없어요" : tab === "important" ? "중요 일정이 없어요" : "일정이 없어요"}
          />
        </div>
      )}

      <EventEditor calendars={calendars} onClose={() => setEditor({ mode: "closed" })} onRemoved={removeEvent} onSaved={upsertEvent} state={editor} />
    </div>
  );
}
