"use client";

import { AlignLeft, Bell, Clock, Link2, MapPin, Plus, Star, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/client-api";
import { addDays, atMinutes, formatMonthDay, formatTime, isSameDay, startOfDay } from "@/lib/dates";
import { type Calendar, type CalendarEvent, canWrite } from "@/lib/types";

import { MeetingNotes } from "./meeting-notes";
import { MiniMonth } from "./mini-month";
import { useToast } from "./toast";
import { PlanTripButton } from "./trip-planner";
import { Button, cn, IconButton, Notice, Picker, Sheet } from "./ui";

type Reminder = { minutesBefore: number; channel: "PUSH" | "SMS" | "ALIMTALK"; audience: "CREATOR" | "ATTENDEES" };

const REMINDER_TIMES = [
  { value: 0, label: "시작할 때" },
  { value: 5, label: "5분 전" },
  { value: 10, label: "10분 전" },
  { value: 30, label: "30분 전" },
  { value: 60, label: "1시간 전" },
  { value: 1440, label: "하루 전" },
];
const CHANNELS = [
  { value: "PUSH", label: "푸시", cost: 0 },
  { value: "SMS", label: "문자", cost: 1 },
  { value: "ALIMTALK", label: "알림톡", cost: 1 },
] as const;
const DURATIONS = [30, 60, 90, 120];
const DEFAULT_COLOR = "#3F3F46";
const MINUTE = 60_000;

export type EditorState = { mode: "closed" } | { mode: "edit"; event: CalendarEvent } | { mode: "create"; start: Date; end?: Date; allDay?: boolean };

/** Start for a new event on `day`: the next half hour if it's today, otherwise 09:00. */
export function defaultStart(day: Date) {
  const now = new Date();
  if (!isSameDay(day, now)) return atMinutes(day, 9 * 60);
  return atMinutes(day, Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30);
}

/** The server returns a bare event; the UI needs its calendar's name/color and the importance flag. */
export function withCalendar(raw: Omit<CalendarEvent, "calendar" | "isImportant" | "color"> & { color?: string | null }, calendars: Calendar[], isImportant = false): CalendarEvent {
  const calendar = calendars.find((c) => c.id === raw.calendarId);
  return {
    ...raw,
    color: raw.color ?? calendar?.color ?? DEFAULT_COLOR,
    isImportant,
    calendar: { id: raw.calendarId, name: calendar?.name ?? "캘린더", type: calendar?.type ?? "PERSONAL", color: calendar?.color ?? DEFAULT_COLOR },
  };
}

const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}시간` : "", m ? `${m}분` : ""].filter(Boolean).join(" ");
};

type Props = {
  state: EditorState;
  calendars: Calendar[];
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onRemoved: (eventId: string) => void;
  /** Shown on a new event: switch to the AI travel itinerary sheet instead */
  onPlanTrip?: () => void;
};

/**
 * One sheet for creating, viewing and editing. An existing event opens straight into its (editable) form;
 * delete happens immediately with "되돌리기" in a toast instead of a confirm dialog.
 */
export function EventEditor({ state, calendars, onClose, onSaved, onRemoved, onPlanTrip }: Props) {
  if (state.mode === "closed") return null;
  const key = state.mode === "edit" ? state.event.id : `new-${state.start.getTime()}-${state.end?.getTime()}`;
  return <EditorForm calendars={calendars} key={key} onClose={onClose} onPlanTrip={onPlanTrip} onRemoved={onRemoved} onSaved={onSaved} state={state} />;
}

function EditorForm({ state, calendars, onClose, onSaved, onRemoved, onPlanTrip }: Props & { state: Exclude<EditorState, { mode: "closed" }> }) {
  const toast = useToast();
  const formId = useId();
  const event = state.mode === "edit" ? state.event : null;
  const writableCalendars = calendars.filter(canWrite);
  const ownCalendar = event ? calendars.find((c) => c.id === event.calendarId) : undefined;
  const readOnly = event ? !ownCalendar || !canWrite(ownCalendar) : false;
  const calendarOptions = readOnly && ownCalendar ? [ownCalendar] : writableCalendars;

  const [title, setTitle] = useState(event?.title ?? "");
  // A new event can go to several calendars at once (one copy each); an existing event lives in exactly one.
  const [calendarIds, setCalendarIds] = useState(() => [event?.calendarId ?? writableCalendars.find((c) => c.isDefault)?.id ?? writableCalendars[0]?.id ?? ""]);
  const [allDay, setAllDay] = useState(event?.allDay ?? (state.mode === "create" && Boolean(state.allDay)));
  const [start, setStart] = useState(() => (event ? new Date(event.startsAt) : state.mode === "create" && state.allDay ? startOfDay(state.start) : state.mode === "create" ? state.start : new Date()));
  const [end, setEnd] = useState(() => (event ? new Date(event.endsAt) : state.mode === "create" && state.allDay ? addDays(startOfDay(state.start), 1) : state.mode === "create" && state.end ? state.end : new Date((state.mode === "create" ? state.start : new Date()).getTime() + 60 * MINUTE)));
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const savedReminders = useRef<Reminder[]>([]);
  const [important, setImportant] = useState(event?.isImportant ?? false);
  const [picker, setPicker] = useState<"startDate" | "startTime" | "endDate" | "endTime" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!event || readOnly) return;
    api<{ reminders: Reminder[] }>(`/events/${event.id}/reminders`)
      .then((r) => {
        savedReminders.current = r.reminders;
        setReminders(r.reminders);
      })
      .catch(() => undefined);
  }, [event, readOnly]);

  const duration = (end.getTime() - start.getTime()) / MINUTE;
  const timeError = end <= start ? "끝나는 시간이 시작보다 늦어야 해요." : null;
  const togglePicker = (next: NonNullable<typeof picker>) => setPicker((current) => (current === next ? null : next));

  function moveStart(next: Date) {
    setEnd(new Date(next.getTime() + (end.getTime() - start.getTime()))); // keep the length
    setStart(next);
  }

  function toggleAllDay(on: boolean) {
    setAllDay(on);
    setPicker(null);
    if (on) {
      const first = startOfDay(start);
      setStart(first);
      setEnd(addDays(startOfDay(new Date(Math.max(end.getTime() - 1, first.getTime()))), 1));
    } else {
      const first = atMinutes(start, 9 * 60);
      setStart(first);
      setEnd(new Date(first.getTime() + 60 * MINUTE));
    }
  }

  async function save(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!title.trim() || timeError || readOnly) return;
    setBusy(true);
    setError(null);
    const body = {
      title: title.trim(),
      location: location.trim(),
      description: description.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      allDay,
    };
    const remaining = [...calendarIds];
    try {
      if (event) {
        const { event: saved } = await api<{ event: CalendarEvent }>(`/events/${event.id}`, { method: "PATCH", body: { ...body, calendarId: calendarIds[0] } });
        if (JSON.stringify(reminders) !== JSON.stringify(savedReminders.current)) {
          await api(`/events/${saved.id}/reminders`, { method: "PUT", body: { reminders } });
        }
        onSaved(withCalendar(saved, calendars, important));
      } else {
        for (const calendarId of calendarIds) {
          const { event: saved } = await api<{ event: CalendarEvent }>("/events", { body: { ...body, calendarId } });
          if (reminders.length) await api(`/events/${saved.id}/reminders`, { method: "PUT", body: { reminders } });
          onSaved(withCalendar(saved, calendars));
          remaining.shift();
        }
      }
      onClose();
      toast.show(event ? "저장했어요" : calendarIds.length > 1 ? `캘린더 ${calendarIds.length}곳에 추가했어요` : "일정을 추가했어요");
    } catch (e) {
      // Some copies may already exist: keep only the calendars still to do, so saving again doesn't duplicate.
      const partly = !event && remaining.length < calendarIds.length;
      if (partly) setCalendarIds(remaining);
      setError(partly ? `${errorMessage(e)} 이미 추가된 캘린더는 목록에서 뺐어요.` : errorMessage(e));
      setBusy(false);
    }
  }

  function pickCalendar(id: string) {
    if (event) return setCalendarIds([id]);
    setCalendarIds((current) => (!current.includes(id) ? [...current, id] : current.length > 1 ? current.filter((x) => x !== id) : current));
  }

  async function remove() {
    if (!event) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}`, { method: "DELETE" });
      onRemoved(event.id);
      onClose();
      const kept = { event: { ...event, isImportant: important }, reminders: savedReminders.current };
      toast.show("일정을 삭제했어요", {
        label: "되돌리기",
        onClick: () =>
          void restoreEvent(kept.event, kept.reminders, calendars)
            .then(onSaved)
            .catch((e) => toast.show(errorMessage(e))),
      });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function toggleImportant() {
    if (!event) return;
    try {
      const result = await api<{ isImportant: boolean }>(`/events/${event.id}/important`, { method: "PATCH" });
      setImportant(result.isImportant);
      onSaved({ ...event, isImportant: result.isImportant });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function share() {
    if (!event) return;
    try {
      const { url } = await api<{ url: string }>(`/events/${event.id}/shares`, { body: { channel: "LINK", includeDescription: true, includeLocation: true } });
      if (navigator.share) await navigator.share({ title: event.title, url }).catch(() => undefined);
      else {
        await navigator.clipboard?.writeText(url);
        toast.show("공유 링크를 복사했어요");
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!event && !writableCalendars.length) {
    return (
      <Sheet onClose={onClose} open title="새 일정">
        <Notice>일정을 추가할 수 있는 캘린더가 없어요.</Notice>
      </Sheet>
    );
  }

  const startSlots = Array.from({ length: 96 }, (_, i) => atMinutes(start, i * 15));
  const endSlots = Array.from({ length: 96 }, (_, i) => new Date(start.getTime() + (i + 1) * 15 * MINUTE));
  const lastDay = allDay ? addDays(end, -1) : end;

  return (
    <Sheet
      footer={
        readOnly ? undefined : (
          <Button block disabled={!title.trim() || Boolean(timeError)} form={formId} loading={busy} type="submit">
            {event ? "저장" : "일정 추가"}
          </Button>
        )
      }
      headerAction={
        event ? (
          <div className="flex">
            <IconButton aria-pressed={important} label={important ? "중요 해제" : "중요 표시"} onClick={toggleImportant}>
              <Star className={important ? "fill-fg text-fg" : ""} size={19} />
            </IconButton>
            <IconButton label="공유 링크" onClick={share}>
              <Link2 size={19} />
            </IconButton>
            {!readOnly ? (
              <IconButton className="hover:text-danger" disabled={busy} label="삭제" onClick={remove}>
                <Trash2 size={19} />
              </IconButton>
            ) : null}
          </div>
        ) : onPlanTrip ? (
          <PlanTripButton onClick={onPlanTrip} />
        ) : undefined
      }
      onClose={onClose}
      open
      title={event ? (readOnly ? "일정" : "일정 수정") : "새 일정"}
    >
      <form id={formId} onSubmit={save}>
        <fieldset className="min-w-0 space-y-1 disabled:opacity-100" disabled={readOnly}>
          <input
            aria-label="제목"
            autoFocus={!event}
            className="h-14 w-full bg-transparent text-[22px] font-bold tracking-tight outline-none placeholder:text-fg-3"
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
            value={title}
          />

          <Row icon={<Clock size={18} />}>
            <div className="flex h-11 items-center justify-between">
              <span className="text-[15px] font-medium">하루 종일</span>
              <Switch checked={allDay} label="하루 종일" onChange={toggleAllDay} />
            </div>

            <TimeLine label="시작">
              <Chip active={picker === "startDate"} onClick={() => togglePicker("startDate")}>
                {formatMonthDay(start)}
              </Chip>
              {!allDay ? (
                <Chip active={picker === "startTime"} onClick={() => togglePicker("startTime")}>
                  {formatTime(start)}
                </Chip>
              ) : null}
            </TimeLine>
            {picker === "startDate" ? (
              <Panel>
                <MiniMonth
                  month={start}
                  onSelect={(date) => {
                    moveStart(atMinutes(date, start.getHours() * 60 + start.getMinutes()));
                    setPicker(null);
                  }}
                  selected={start}
                  withHeader
                />
              </Panel>
            ) : null}
            {picker === "startTime" ? (
              <TimeList
                onPick={(slot) => {
                  moveStart(slot);
                  setPicker(null);
                }}
                slots={startSlots}
                value={start}
              />
            ) : null}

            <TimeLine label="종료">
              <Chip active={picker === "endDate"} danger={Boolean(timeError)} onClick={() => togglePicker("endDate")}>
                {formatMonthDay(lastDay)}
              </Chip>
              {!allDay ? (
                <Chip active={picker === "endTime"} danger={Boolean(timeError)} onClick={() => togglePicker("endTime")}>
                  {formatTime(end)}
                </Chip>
              ) : null}
            </TimeLine>
            {picker === "endDate" ? (
              <Panel>
                <MiniMonth
                  month={lastDay}
                  onSelect={(date) => {
                    setEnd(allDay ? addDays(date, 1) : atMinutes(date, end.getHours() * 60 + end.getMinutes()));
                    setPicker(null);
                  }}
                  selected={lastDay}
                  withHeader
                />
              </Panel>
            ) : null}
            {picker === "endTime" ? (
              <TimeList
                describe={(slot) => formatDuration((slot.getTime() - start.getTime()) / MINUTE)}
                onPick={(slot) => {
                  setEnd(slot);
                  setPicker(null);
                }}
                slots={endSlots}
                value={end}
              />
            ) : null}

            {timeError ? <p className="pb-1 text-[13px] font-medium text-danger">{timeError}</p> : null}
            {!allDay && !readOnly ? (
              <div className="flex gap-1.5 overflow-x-auto pb-2 pt-1 scrollbar-hide">
                {DURATIONS.map((minutes) => (
                  <button
                    className={cn(
                      "h-8 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition-colors",
                      duration === minutes ? "bg-surface text-fg ring-1 ring-inset ring-fg" : "bg-surface-2 text-fg-2 hover:bg-surface-3",
                    )}
                    key={minutes}
                    onClick={() => setEnd(new Date(start.getTime() + minutes * MINUTE))}
                    type="button"
                  >
                    {formatDuration(minutes)}
                  </button>
                ))}
              </div>
            ) : null}
          </Row>

          <Row icon={<span className="block size-3 rounded-full" style={{ backgroundColor: calendarOptions.find((c) => c.id === calendarIds[0])?.color }} />}>
            <div aria-label={event ? "캘린더" : "캘린더(여러 개 고를 수 있어요)"} className="flex gap-1.5 overflow-x-auto py-2 scrollbar-hide" role={event ? "radiogroup" : "group"}>
              {calendarOptions.map((calendar) => (
                <button
                  aria-checked={calendarIds.includes(calendar.id)}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[14px] font-semibold transition-colors",
                    calendarIds.includes(calendar.id) ? "bg-surface text-fg ring-1 ring-inset ring-fg" : "bg-surface-2 text-fg-2 hover:bg-surface-3",
                  )}
                  key={calendar.id}
                  onClick={() => pickCalendar(calendar.id)}
                  role={event ? "radio" : "checkbox"}
                  type="button"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: calendar.color }} />
                  {calendar.name}
                </button>
              ))}
            </div>
            {!event && calendarIds.length > 1 ? <p className="pb-2 text-[12px] text-fg-3">캘린더 {calendarIds.length}곳에 각각 따로 추가돼요.</p> : null}
          </Row>

          {!readOnly ? (
            <Row icon={<Bell size={18} />}>
              <ReminderEditor onChange={setReminders} value={reminders} />
            </Row>
          ) : null}

          <Row icon={<MapPin size={18} />}>
            <input
              aria-label="장소"
              className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-fg-3"
              maxLength={240}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={readOnly ? "장소 없음" : "장소"}
              value={location}
            />
          </Row>

          <Row icon={<AlignLeft size={18} />}>
            <textarea
              aria-label="메모"
              className="min-h-20 w-full resize-none bg-transparent py-2.5 text-[15px] leading-6 outline-none placeholder:text-fg-3"
              maxLength={4000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={readOnly ? "메모 없음" : "메모"}
              value={description}
            />
          </Row>
        </fieldset>
        {event ? <MeetingNotes canEdit={!readOnly} eventId={event.id} /> : null}

        {readOnly ? <p className="mt-3 text-[13px] text-fg-3">이 캘린더는 보기 권한만 있어요.</p> : null}
        {error ? (
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}

/** Recreate a deleted event (new id) with its reminders and ★, for the "되돌리기" toast. */
async function restoreEvent(event: CalendarEvent, reminders: Reminder[], calendars: Calendar[]) {
  const { event: raw } = await api<{ event: CalendarEvent }>("/events", {
    body: {
      calendarId: event.calendarId,
      title: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      visibility: event.visibility,
    },
  });
  if (reminders.length) await api(`/events/${raw.id}/reminders`, { method: "PUT", body: { reminders } });
  if (event.isImportant) await api(`/events/${raw.id}/important`, { method: "PATCH" });
  return withCalendar(raw, calendars, event.isImportant);
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-line pt-1">
      <span className="flex h-11 w-5 shrink-0 items-center justify-center text-fg-3">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TimeLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-8 shrink-0 text-[13px] font-medium text-fg-3">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, danger, onClick, children }: { active: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-expanded={active}
      className={cn(
        "h-10 rounded-xl px-3 text-[15px] font-semibold tabular-nums transition-colors",
        active ? "bg-surface ring-1 ring-inset ring-fg" : "bg-surface-2 hover:bg-surface-3",
        danger && !active && "text-danger",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="animate-scrim my-1 rounded-2xl bg-surface-2/60 p-2">{children}</div>;
}

/** Scrollable 15-minute slots, opened scrolled to the current value. */
function TimeList({ slots, value, onPick, describe }: { slots: Date[]; value: Date; onPick: (slot: Date) => void; describe?: (slot: Date) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = Math.max(0, slots.findIndex((slot) => slot >= value));

  useEffect(() => {
    const list = ref.current;
    const item = list?.children[near] as HTMLElement | undefined;
    if (list && item) list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="animate-scrim relative my-1 max-h-56 overflow-y-auto rounded-2xl bg-surface-2/60 p-1" ref={ref} role="listbox">
      {slots.map((slot) => {
        const selected = slot.getTime() === value.getTime();
        return (
          <button
            aria-selected={selected}
            className={cn("flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] tabular-nums", selected ? "bg-surface-3 font-semibold" : "hover:bg-surface-3")}
            key={slot.getTime()}
            onClick={() => onPick(slot)}
            role="option"
            type="button"
          >
            {formatTime(slot)}
            {describe ? <span className={cn("text-[13px]", selected ? "text-fg-2" : "text-fg-3")}>{describe(slot)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function ReminderEditor({ value, onChange }: { value: Reminder[]; onChange: (value: Reminder[]) => void }) {
  const cost = value.reduce((sum, r) => sum + (CHANNELS.find((c) => c.value === r.channel)?.cost ?? 0), 0);
  const update = (index: number, patch: Partial<Reminder>) => onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const duplicate = new Set(value.map((r) => `${r.minutesBefore}:${r.channel}`)).size !== value.length;

  return (
    <div className="pb-1">
      {value.map((reminder, index) => (
        <div className="flex items-center gap-2 py-1" key={index}>
          <Picker label="알림 시점" onChange={(minutesBefore) => update(index, { minutesBefore })} options={REMINDER_TIMES} value={reminder.minutesBefore} variant="text" />
          <Picker label="알림 방법" onChange={(channel) => update(index, { channel })} options={[...CHANNELS]} value={reminder.channel} variant="text" />
          <span className="flex-1" />
          <IconButton label="알림 삭제" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            <X size={18} />
          </IconButton>
        </div>
      ))}
      {duplicate ? <p className="py-1 text-xs text-danger">같은 시점·방법의 알림이 중복됐어요.</p> : null}
      <div className="flex h-11 items-center justify-between">
        {value.length < 5 ? (
          <button
            className="flex h-11 items-center gap-1.5 text-[15px] text-fg-3 hover:text-fg"
            onClick={() => onChange([...value, { minutesBefore: 10, channel: "PUSH", audience: "CREATOR" }])}
            type="button"
          >
            <Plus size={16} />
            {value.length ? "알림 추가" : "알림"}
          </button>
        ) : (
          <span />
        )}
        {cost ? <span className="text-xs font-semibold text-fg-3">받는 사람마다 {cost}크레딧</span> : null}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-surface-3")}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={cn("absolute left-0 top-0.5 size-6 rounded-full shadow-card transition-transform", checked ? "translate-x-[22px] bg-on-primary" : "translate-x-0.5 bg-white")} />
    </button>
  );
}
