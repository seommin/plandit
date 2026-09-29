"use client";

import { Bell, CalendarDays, Clock, Link2, MapPin, MessageSquare, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/client-api";
import { addDays, formatEventTime, formatFullDate, startOfDay, toDateInput, toDateTimeInput } from "@/lib/dates";
import { type Calendar, type CalendarEvent, canWrite } from "@/lib/types";

import { Button, cn, Field, IconButton, Notice, Select, Sheet, TextArea, TextInput } from "./ui";

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

const reminderLabel = (r: Reminder) =>
  `${REMINDER_TIMES.find((t) => t.value === r.minutesBefore)?.label ?? `${r.minutesBefore}분 전`} · ${CHANNELS.find((c) => c.value === r.channel)?.label}`;

export type EventSheetState =
  | { mode: "closed" }
  | { mode: "view"; event: CalendarEvent }
  | { mode: "edit"; event: CalendarEvent }
  | { mode: "create"; date: Date };

type Props = {
  state: EventSheetState;
  calendars: Calendar[];
  onChange: (state: EventSheetState) => void;
  /** created or updated (the sheet then shows it) */
  onSaved: (event: CalendarEvent) => void;
  onDeleted: (eventId: string) => void;
};

/** The server returns a bare event; the UI needs its calendar's name/color and the importance flag. */
export function withCalendar(raw: Omit<CalendarEvent, "calendar" | "isImportant" | "color"> & { color?: string | null }, calendars: Calendar[], isImportant = false): CalendarEvent {
  const calendar = calendars.find((c) => c.id === raw.calendarId);
  return {
    ...raw,
    color: raw.color ?? calendar?.color ?? "#3182f6",
    isImportant,
    calendar: { id: raw.calendarId, name: calendar?.name ?? "캘린더", type: calendar?.type ?? "PERSONAL", color: calendar?.color ?? "#3182f6" },
  };
}

export function EventSheet({ state, calendars, onChange, onSaved, onDeleted }: Props) {
  const close = () => onChange({ mode: "closed" });
  const title = state.mode === "create" ? "새 일정" : state.mode === "edit" ? "일정 수정" : state.mode === "view" ? state.event.title : "";

  return (
    <Sheet onClose={close} open={state.mode !== "closed"} title={title}>
      {state.mode === "view" ? (
        <EventDetail calendars={calendars} event={state.event} key={state.event.id} onChange={onChange} onDeleted={onDeleted} onSaved={onSaved} />
      ) : state.mode === "edit" || state.mode === "create" ? (
        <EventForm calendars={calendars} key={state.mode === "edit" ? state.event.id : "new"} onSaved={onSaved} state={state} />
      ) : null}
    </Sheet>
  );
}

function EventDetail({ event, calendars, onChange, onSaved, onDeleted }: { event: CalendarEvent; calendars: Calendar[] } & Pick<Props, "onChange" | "onSaved" | "onDeleted">) {
  const calendar = calendars.find((c) => c.id === event.calendarId);
  const writable = calendar ? canWrite(calendar) : false;
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!writable) return;
    api<{ reminders: Reminder[] }>(`/events/${event.id}/reminders`)
      .then((r) => setReminders(r.reminders))
      .catch(() => setReminders([]));
  }, [event.id, writable]);

  async function toggleImportant() {
    try {
      const result = await api<{ isImportant: boolean }>(`/events/${event.id}/important`, { method: "PATCH" });
      onSaved({ ...event, isImportant: result.isImportant });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ url: string }>(`/events/${event.id}/shares`, {
        body: { channel: "LINK", includeDescription: true, includeLocation: true },
      });
      if (navigator.share) await navigator.share({ title: event.title, url: result.url }).catch(() => undefined);
      else await navigator.clipboard?.writeText(result.url);
      setNotice(`공유 링크를 만들었어요: ${result.url}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("이 일정을 삭제할까요?")) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}`, { method: "DELETE" });
      onDeleted(event.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
        <DetailLine icon={<CalendarDays size={17} />}>
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: event.color }} />
            {event.calendar.name}
          </span>
        </DetailLine>
        <DetailLine icon={<Clock size={17} />}>
          {formatFullDate(new Date(event.startsAt))}
          <span className="block text-fg-2">{formatEventTime(event)}</span>
        </DetailLine>
        {event.location ? <DetailLine icon={<MapPin size={17} />}>{event.location}</DetailLine> : null}
        {event.description ? (
          <DetailLine icon={<MessageSquare size={17} />}>
            <span className="whitespace-pre-wrap">{event.description}</span>
          </DetailLine>
        ) : null}
        {writable ? (
          <DetailLine icon={<Bell size={17} />}>
            {reminders === null ? "알림 불러오는 중" : reminders.length ? reminders.map(reminderLabel).join(", ") : "알림 없음"}
          </DetailLine>
        ) : null}
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}

      <div className="grid grid-cols-4 gap-2">
        <ActionButton active={event.isImportant} icon={<Star className={event.isImportant ? "fill-warning text-warning" : ""} size={20} />} label="중요" onClick={toggleImportant} />
        <ActionButton disabled={busy} icon={<Link2 size={20} />} label="공유" onClick={share} />
        <ActionButton disabled={!writable} icon={<Pencil size={20} />} label="수정" onClick={() => onChange({ mode: "edit", event })} />
        <ActionButton danger disabled={!writable || busy} icon={<Trash2 size={20} />} label="삭제" onClick={remove} />
      </div>
    </div>
  );
}

function DetailLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[15px] font-medium text-fg">
      <span className="mt-0.5 text-fg-3">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, danger, active }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; active?: boolean }) {
  return (
    <button
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold transition-colors disabled:opacity-40",
        danger ? "bg-danger-weak text-danger" : active ? "bg-warning-weak text-fg" : "bg-surface-2 text-fg-2 hover:bg-surface-3",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function EventForm({ state, calendars, onSaved }: { state: Extract<EventSheetState, { mode: "edit" | "create" }>; calendars: Calendar[]; onSaved: Props["onSaved"] }) {
  const editing = state.mode === "edit" ? state.event : null;
  const writable = calendars.filter(canWrite);
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Defaults for a new event: next half hour today, or 09:00 on another day; one hour long.
  const initialStart = (() => {
    if (editing) return new Date(editing.startsAt);
    const date = new Date(state.mode === "create" ? state.date : Date.now());
    const now = new Date();
    if (startOfDay(date).getTime() === startOfDay(now).getTime()) date.setHours(now.getHours(), now.getMinutes() < 30 ? 30 : 60, 0, 0);
    else date.setHours(9, 0, 0, 0);
    return date;
  })();
  const initialEnd = editing ? new Date(editing.endsAt) : new Date(initialStart.getTime() + 3_600_000);

  useEffect(() => {
    if (!editing) return;
    api<{ reminders: Reminder[] }>(`/events/${editing.id}/reminders`)
      .then((r) => setReminders(r.reminders))
      .catch(() => undefined);
  }, [editing]);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    let startsAt: Date;
    let endsAt: Date;
    if (allDay) {
      startsAt = startOfDay(new Date(`${data.get("startDate")}T00:00`));
      endsAt = addDays(startOfDay(new Date(`${data.get("endDate")}T00:00`)), 1); // all-day ends exclusive
    } else {
      startsAt = new Date(String(data.get("startsAt")));
      endsAt = new Date(String(data.get("endsAt")));
    }
    if (!(endsAt > startsAt)) return setError("끝나는 시간이 시작보다 늦어야 해요.");

    const body = {
      calendarId: String(data.get("calendarId")),
      title: String(data.get("title")).trim(),
      location: String(data.get("location") ?? "").trim() || undefined,
      description: String(data.get("description") ?? "").trim() || undefined,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      allDay,
    };

    setSaving(true);
    setError(null);
    try {
      const { event } = editing
        ? await api<{ event: CalendarEvent }>(`/events/${editing.id}`, { method: "PATCH", body })
        : await api<{ event: CalendarEvent }>("/events", { body });
      await api(`/events/${event.id}/reminders`, { method: "PUT", body: { reminders } });
      onSaved(withCalendar(event, calendars, editing?.isImportant ?? false));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!writable.length) return <Notice>일정을 추가할 수 있는 캘린더가 없어요.</Notice>;

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="제목">
        <TextInput autoFocus={!editing} defaultValue={editing?.title} maxLength={120} name="title" placeholder="무엇을 하나요?" required />
      </Field>
      <Field label="캘린더">
        <Select defaultValue={editing?.calendarId ?? writable.find((c) => c.isDefault)?.id ?? writable[0].id} name="calendarId">
          {writable.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5">
        <span className="text-[15px] font-semibold">하루 종일</span>
        <Switch checked={allDay} label="하루 종일" onChange={setAllDay} />
      </div>

      {allDay ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일">
            <TextInput defaultValue={toDateInput(initialStart)} name="startDate" required type="date" />
          </Field>
          <Field label="종료일">
            <TextInput defaultValue={toDateInput(editing?.allDay ? addDays(initialEnd, -1) : initialEnd)} name="endDate" required type="date" />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시작">
            <TextInput defaultValue={toDateTimeInput(initialStart)} name="startsAt" required type="datetime-local" />
          </Field>
          <Field label="종료">
            <TextInput defaultValue={toDateTimeInput(initialEnd)} name="endsAt" required type="datetime-local" />
          </Field>
        </div>
      )}

      <Field label="장소">
        <TextInput defaultValue={editing?.location ?? ""} maxLength={240} name="location" placeholder="장소 추가" />
      </Field>
      <Field label="메모">
        <TextArea defaultValue={editing?.description ?? ""} maxLength={4000} name="description" placeholder="메모 추가" />
      </Field>

      <ReminderEditor onChange={setReminders} value={reminders} />

      {error ? <Notice>{error}</Notice> : null}
      <Button block loading={saving} type="submit">
        {editing ? "저장" : "일정 추가"}
      </Button>
    </form>
  );
}

function ReminderEditor({ value, onChange }: { value: Reminder[]; onChange: (value: Reminder[]) => void }) {
  const cost = value.reduce((sum, r) => sum + (CHANNELS.find((c) => c.value === r.channel)?.cost ?? 0), 0);
  const update = (index: number, patch: Partial<Reminder>) => onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const duplicate = new Set(value.map((r) => `${r.minutesBefore}:${r.channel}`)).size !== value.length;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-fg-2">알림</span>
        {cost ? <span className="text-xs font-semibold text-fg-3">받는 사람마다 {cost}크레딧</span> : null}
      </div>
      <div className="space-y-2">
        {value.map((reminder, index) => (
          <div className="flex items-center gap-2" key={index}>
            <div className="min-w-0 flex-1">
              <Select aria-label="알림 시점" onChange={(e) => update(index, { minutesBefore: Number(e.target.value) })} value={reminder.minutesBefore}>
                {REMINDER_TIMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-28 shrink-0">
              <Select aria-label="알림 방법" onChange={(e) => update(index, { channel: e.target.value as Reminder["channel"] })} value={reminder.channel}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <IconButton label="알림 삭제" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              <X size={18} />
            </IconButton>
          </div>
        ))}
      </div>
      {duplicate ? <p className="mt-1 text-xs text-danger">같은 시점·방법의 알림이 중복됐어요.</p> : null}
      {value.length < 5 ? (
        <Button className="mt-2" onClick={() => onChange([...value, { minutesBefore: 10, channel: "PUSH", audience: "CREATOR" }])} size="sm" variant="ghost">
          <Plus size={16} />
          알림 추가
        </Button>
      ) : null}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-surface-3")}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow-card transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}
