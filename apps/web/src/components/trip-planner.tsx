"use client";

import {
  TRIP_CATEGORY_LABELS,
  TRIP_INTEREST_LABELS,
  TRIP_INTERESTS,
  TRIP_MAX_DAYS,
  TRIP_PACE_LABELS,
  TRIP_PACES,
  type TripDraft,
  tripDayCount,
  type TripItem,
} from "@plandit/shared/trips";
import { Check, Pencil, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { addDays, toDateInput, WEEKDAYS } from "@/lib/dates";
import type { Calendar } from "@/lib/types";

import { useToast } from "./toast";
import { type Revision, RevisionChat, RevisionPreview } from "./trip-revisions";
import { Button, cn, Field, Notice, Picker, Segmented, Sheet, Spinner, TextArea, TextInput } from "./ui";

type Pace = (typeof TRIP_PACES)[number];
type Interest = (typeof TRIP_INTERESTS)[number];
type Member = { id: string; name: string; email: string; onCalendar: boolean; selectable: boolean };
type Options = { attendeesAllowed: boolean; canAddMembers: boolean; members: Member[]; maxCredits: Record<string, number>; balance: number };
type Plan = {
  id: string;
  status: "GENERATING" | "READY" | "FAILED" | "APPLIED";
  failureCode: string | null;
  calendar: { id: string; name: string };
  draft: TripDraft | null;
  estimatedCredits: number;
  credits: number;
  attendees: Array<{ id: string; name: string | null }>;
  newCalendarMemberIds: string[];
  addedCalendarMemberIds: string[];
  eventCount: number;
  revisions: Revision[];
};
type EditItem = TripItem & { key: string; off: boolean };
type EditDay = { date: string; items: EditItem[] };

const RESUME_KEY = "plandit-trip-plan";
const plansPath = (workspaceId: string) => `/workspaces/${workspaceId}/trip-plans`;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function remember(value: { workspaceId: string; planId: string } | null) {
  try {
    if (value) window.localStorage.setItem(RESUME_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(RESUME_KEY);
  } catch {
    // private mode: an unfinished plan just isn't reopened
  }
}
function remembered(): { workspaceId: string; planId: string } | null {
  try {
    return JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? "null");
  } catch {
    return null;
  }
}

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
};
const toEditDays = (draft: TripDraft): EditDay[] =>
  draft.days.map((day) => ({ date: day.date, items: day.items.map((item, i) => ({ ...item, key: `${day.date}-${i}`, off: false })) }));

/**
 * "AI로 여행 일정 짜기": form → the model drafts in the background → review (turn items off, fix titles and times)
 * → confirm anyone who will be added to the calendar → apply, with "되돌리기" in the toast.
 * An unfinished plan is remembered, so closing the sheet never throws away the credits it reserved.
 */
export function TripPlanner({ open, calendars, defaultDate, onClose, onApplied }: {
  open: boolean;
  calendars: Calendar[];
  defaultDate: Date;
  onClose: () => void;
  onApplied: () => void;
}) {
  if (!open) return null;
  return <TripPlannerSheet calendars={calendars} defaultDate={defaultDate} onApplied={onApplied} onClose={onClose} />;
}

function TripPlannerSheet({ calendars, defaultDate, onClose, onApplied }: Omit<Parameters<typeof TripPlanner>[0], "open">) {
  const toast = useToast();
  const [step, setStep] = useState<"form" | "waiting" | "review" | "failed">("form");
  const [calendarId, setCalendarId] = useState(() => (calendars.find((c) => c.type === "SHARED") ?? calendars[0])?.id ?? "");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState(() => toDateInput(defaultDate));
  const [endDate, setEndDate] = useState(() => toDateInput(addDays(defaultDate, 2)));
  const [attendees, setAttendees] = useState<string[]>([]);
  const [pace, setPace] = useState<Pace>("NORMAL");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [request, setRequest] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planWorkspaceId, setPlanWorkspaceId] = useState<string | null>(null);
  const [days, setDays] = useState<EditDay[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef(newKey());

  const calendar = calendars.find((c) => c.id === calendarId);
  const dayCount = startDate && endDate ? tripDayCount(startDate, endDate) : 0;
  const maxCredits = options?.maxCredits[String(dayCount)];
  const datesOk = dayCount >= 1 && dayCount <= TRIP_MAX_DAYS;
  const affordable = maxCredits === undefined || (options?.balance ?? 0) >= maxCredits;

  // Same form, same key: pressing "만들기" twice (or retrying after a dropped connection) makes one plan.
  useEffect(() => {
    requestKey.current = newKey();
  }, [calendarId, destination, startDate, endDate, attendees, pace, interests, request]);

  const showPlan = useCallback((next: Plan) => {
    setPlan(next);
    if (next.status === "GENERATING") setStep("waiting");
    else if (next.status === "READY" && next.draft) {
      setDays(toEditDays(next.draft));
      setDirty(false);
      setStep("review");
    } else if (next.status === "FAILED") setStep("failed");
  }, []);

  // Reopen an unfinished plan instead of starting over.
  useEffect(() => {
    const saved = remembered();
    if (!saved) return;
    api<Plan>(`${plansPath(saved.workspaceId)}/${saved.planId}`)
      .then((found) => {
        if (found.status !== "GENERATING" && found.status !== "READY") return remember(null);
        setPlanWorkspaceId(saved.workspaceId);
        showPlan(found);
      })
      .catch(() => remember(null));
  }, [showPlan]);

  useEffect(() => {
    if (!calendar || step !== "form") return;
    let live = true;
    setOptions(null);
    api<Options>(`${plansPath(calendar.workspaceId)}/options?calendarId=${calendar.id}`)
      .then((next) => {
        if (!live) return;
        setOptions(next);
        setAttendees((current) => current.filter((id) => next.members.some((m) => m.id === id && m.selectable)));
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [calendar, step]);

  // While the model works: ask every 2 seconds.
  useEffect(() => {
    if (step !== "waiting" || !plan || !planWorkspaceId) return;
    const timer = setInterval(() => {
      api<Plan>(`${plansPath(planWorkspaceId)}/${plan.id}`)
        .then((next) => next.status !== "GENERATING" && showPlan(next))
        .catch(() => undefined); // a missed poll is retried on the next tick
    }, 2_000);
    return () => clearInterval(timer);
  }, [step, plan, planWorkspaceId, showPlan]);

  // While the AI rewrites the draft: ask every 2 seconds until its proposal (or failure) is there.
  const revising = plan?.revisions?.some((r) => r.status === "PENDING");
  useEffect(() => {
    if (!revising || !plan || !planWorkspaceId) return;
    const timer = setInterval(() => {
      api<Plan>(`${plansPath(planWorkspaceId)}/${plan.id}`)
        .then(setPlan)
        .catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [revising, plan?.id, planWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!calendar) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<Plan>(plansPath(calendar.workspaceId), {
        body: { calendarId: calendar.id, destination, startDate, endDate, attendeeUserIds: attendees, pace, interests, request },
        headers: { "idempotency-key": requestKey.current },
      });
      remember({ workspaceId: calendar.workspaceId, planId: created.id });
      setPlanWorkspaceId(calendar.workspaceId);
      showPlan(created);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const kept = days.map((day) => ({ date: day.date, items: day.items.filter((item) => !item.off) })).filter((day) => day.items.length);
  const keptCount = kept.reduce((n, day) => n + day.items.length, 0);
  const badTimes = days.some((day) => day.items.some((item) => !item.off && item.endTime <= item.startTime));
  const newcomers = plan ? plan.attendees.filter((a) => plan.newCalendarMemberIds.includes(a.id)) : [];
  const proposal = plan?.revisions?.find((r) => r.status === "PROPOSED");

  function editItem(key: string, change: Partial<EditItem>) {
    setDays((current) => current.map((day) => ({ ...day, items: day.items.map((item) => (item.key === key ? { ...item, ...change } : item)) })));
    setDirty(true);
  }

  /** Edits made by hand go to the server first, so the AI rewrites (and apply uses) what is on the screen. */
  async function saveEdits(workspaceId: string, planId: string) {
    if (!dirty) return;
    const strip = kept.map((day) => ({ date: day.date, items: day.items.map(({ key: _key, off: _off, ...item }) => item) }));
    await api(`${plansPath(workspaceId)}/${planId}`, { method: "PATCH", body: { days: strip } });
    setDirty(false);
  }

  /** "둘째 날 오후는 쉬게 해줘" → the worker rewrites, the preview below shows what would change (PLANDIT-27). */
  async function revise(request: string) {
    const workspaceId = planWorkspaceId;
    if (!plan || !workspaceId) return false;
    setBusy(true);
    setError(null);
    try {
      await saveEdits(workspaceId, plan.id);
      setPlan(await api<Plan>(`${plansPath(workspaceId)}/${plan.id}/revisions`, { body: { request }, headers: { "idempotency-key": newKey() } }));
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function decide(accept: boolean) {
    const workspaceId = planWorkspaceId;
    if (!plan || !workspaceId || !proposal) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<Plan>(`${plansPath(workspaceId)}/${plan.id}/revisions/${proposal.id}/${accept ? "accept" : "discard"}`, { method: "POST" });
      if (accept) showPlan(next);
      else setPlan(next);
    } catch (e) {
      setError(errorMessage(e));
      api<Plan>(`${plansPath(workspaceId)}/${plan.id}`).then(setPlan).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const workspaceId = planWorkspaceId;
    if (!plan || !workspaceId) return;
    if (plan.newCalendarMemberIds.length && !confirming) return setConfirming(true);
    setBusy(true);
    setError(null);
    try {
      await saveEdits(workspaceId, plan.id);
      const applied = await api<Plan>(`${plansPath(workspaceId)}/${plan.id}/apply`, { body: { newCalendarMemberIds: plan.newCalendarMemberIds } });
      remember(null);
      onApplied();
      onClose();
      const undo = () =>
        api(`${plansPath(workspaceId)}/${applied.id}/events`, { method: "DELETE" })
          .then(() => {
            onApplied();
            toast.show(applied.addedCalendarMemberIds.length ? "되돌렸어요. 캘린더에 추가된 사람은 그대로예요." : "되돌렸어요.");
          })
          .catch((e) => toast.show(errorMessage(e)));
      toast.show(`일정 ${applied.eventCount}개를 캘린더에 넣었어요`, { label: "되돌리기", onClick: () => void undo() });
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "CALENDAR_MEMBERS_CHANGED") {
        const fresh = await api<Plan>(`${plansPath(workspaceId)}/${plan.id}`).catch(() => plan);
        setPlan(fresh);
        setConfirming(fresh.newCalendarMemberIds.length > 0);
      } else setConfirming(false);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    remember(null);
    requestKey.current = newKey();
    setPlan(null);
    setPlanWorkspaceId(null);
    setConfirming(false);
    setError(null);
    setStep("form");
  }

  const footer =
    step === "form" ? (
      <div className="space-y-2">
        {maxCredits !== undefined ? (
          <p className="text-center text-[13px] text-fg-3">최대 {maxCredits.toLocaleString()} 크레딧 · 만들고 남은 만큼 돌려드려요</p>
        ) : null}
        <Button block disabled={!calendar || !destination.trim() || !datesOk || !affordable || !options} loading={busy} onClick={create}>
          <Sparkles size={18} />
          일정 만들기
        </Button>
      </div>
    ) : step === "review" ? (
      revising || proposal ? (
        <p className="text-center text-sm text-fg-3">{revising ? "AI가 초안을 고치는 중이에요" : "고친 초안을 반영하거나 안 하면 캘린더에 넣을 수 있어요"}</p>
      ) : confirming ? (
        <div className="space-y-3">
          <p className="text-[14px] leading-relaxed text-fg-2">
            {newcomers.map((a) => `${a.name ?? "알 수 없음"}님`).join(", ")}이 &lsquo;{plan?.calendar.name}&rsquo; 캘린더에 보기 권한으로 추가돼요. 이 캘린더의 다른 일정도 볼 수 있어요.
          </p>
          <div className="flex gap-2">
            <Button block onClick={() => setConfirming(false)} variant="secondary">
              취소
            </Button>
            <Button block loading={busy} onClick={apply}>
              추가하고 넣기
            </Button>
          </div>
        </div>
      ) : (
        <Button block disabled={!keptCount || badTimes} loading={busy} onClick={apply}>
          캘린더에 {keptCount}개 넣기
        </Button>
      )
    ) : step === "failed" ? (
      <Button block onClick={startOver}>
        다시 만들기
      </Button>
    ) : undefined;

  return (
    <Sheet footer={footer} onClose={onClose} open title="AI 여행 일정">
      <div className="space-y-5">
        {error ? <Notice>{error}</Notice> : null}

        {step === "form" ? (
          <>
            <Field label="캘린더">
              <Picker label="캘린더" onChange={setCalendarId} options={calendars.map((c) => ({ value: c.id, label: c.name }))} value={calendarId} />
            </Field>
            <Field label="어디로 가요?">
              <TextInput maxLength={80} onChange={(e) => setDestination(e.target.value)} placeholder="예: 부산, 도쿄" value={destination} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="가는 날">
                <TextInput onChange={(e) => setStartDate(e.target.value)} type="date" value={startDate} />
              </Field>
              <Field label="오는 날">
                <TextInput min={startDate} onChange={(e) => setEndDate(e.target.value)} type="date" value={endDate} />
              </Field>
            </div>
            {!datesOk ? <Notice>여행 기간은 1~{TRIP_MAX_DAYS}일로 골라주세요.</Notice> : null}

            {options?.attendeesAllowed ? (
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-semibold text-fg-2">함께 가는 사람</legend>
                {options.members.length ? (
                  <ul className="space-y-1">
                    {options.members.map((m) => {
                      const on = attendees.includes(m.id);
                      return (
                        <li key={m.id}>
                          <button
                            aria-checked={on}
                            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                            disabled={!m.selectable}
                            onClick={() => setAttendees(on ? attendees.filter((id) => id !== m.id) : [...attendees, m.id])}
                            role="checkbox"
                            type="button"
                          >
                            <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border", on ? "border-fg bg-fg text-bg" : "border-line-strong")}>
                              {on ? <Check size={14} strokeWidth={3} /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-medium">{m.name}</span>
                              <span className="block truncate text-xs text-fg-3">
                                {m.onCalendar ? "캘린더 멤버" : m.selectable ? "캘린더에 보기 권한으로 추가돼요" : "캘린더 관리자만 함께 넣을 수 있어요"}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-1 text-sm text-fg-3">이 워크스페이스에 다른 멤버가 없어요.</p>
                )}
              </fieldset>
            ) : options ? (
              <p className="px-1 text-sm text-fg-3">개인 캘린더라 혼자 가는 일정으로 만들어요.</p>
            ) : null}

            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-fg-2">여행 속도</p>
              <Segmented label="여행 속도" onChange={setPace} options={TRIP_PACES.map((p) => ({ value: p, label: TRIP_PACE_LABELS[p] }))} value={pace} />
            </div>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold text-fg-2">관심 있는 것</legend>
              <div className="flex flex-wrap gap-2">
                {TRIP_INTERESTS.map((interest) => {
                  const on = interests.includes(interest);
                  return (
                    <button
                      aria-pressed={on}
                      className={cn("h-11 rounded-xl px-4 text-[15px] font-semibold transition-colors", on ? "bg-surface ring-1 ring-inset ring-fg" : "bg-surface-2 hover:bg-surface-3")}
                      key={interest}
                      onClick={() => setInterests(on ? interests.filter((i) => i !== interest) : [...interests, interest])}
                      type="button"
                    >
                      {TRIP_INTEREST_LABELS[interest]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field hint={`${request.length}/500`} label="더 바라는 점 (선택)">
              <TextArea maxLength={500} onChange={(e) => setRequest(e.target.value)} placeholder="예: 둘째 날은 바다가 보이는 카페에 가고 싶어요" value={request} />
            </Field>
            {!affordable ? (
              <Notice>
                크레딧이 부족해요(지금 {options?.balance.toLocaleString()}).{" "}
                <Link className="underline" href="/credits">
                  충전하러 가기
                </Link>
              </Notice>
            ) : null}
          </>
        ) : null}

        {step === "waiting" ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center" role="status">
            <Spinner className="size-6 text-fg-2" />
            <p className="text-[15px] font-semibold">AI가 여행 일정을 짜고 있어요</p>
            <p className="text-sm text-fg-3">보통 1분 안에 끝나요. 창을 닫았다가 다시 열어도 이어서 볼 수 있어요.</p>
          </div>
        ) : null}

        {step === "failed" ? (
          <Notice>일정을 만들지 못했어요. 쓴 크레딧은 모두 돌려드렸어요.</Notice>
        ) : null}

        {step === "review" && plan?.draft ? (
          <>
            <Notice tone="info">AI가 만든 초안이에요. 영업시간·휴무일은 한 번 더 확인해주세요. 넣지 않을 항목은 체크를 풀어주세요.</Notice>
            {plan.draft.notes ? <p className="px-1 text-sm leading-relaxed text-fg-2">{plan.draft.notes}</p> : null}
            {proposal ? (
              <RevisionPreview busy={busy} onDecide={(accept) => void decide(accept)} revision={proposal} />
            ) : (
              <fieldset className="space-y-5 disabled:opacity-60" disabled={revising}>
            {days.map((day) => (
              <section key={day.date}>
                <h3 className="mb-1 px-1 text-[13px] font-semibold text-fg-3">{dayLabel(day.date)}</h3>
                <ul className="space-y-1">
                  {day.items.map((item) => (
                    <li className="rounded-xl" key={item.key}>
                      <div className="flex min-h-11 items-start gap-2">
                        <button
                          aria-checked={!item.off}
                          aria-label={`${item.title} 넣기`}
                          className="flex size-11 shrink-0 items-center justify-center"
                          onClick={() => editItem(item.key, { off: !item.off })}
                          role="checkbox"
                          type="button"
                        >
                          <span aria-hidden="true" className={cn("flex size-5 items-center justify-center rounded-md border", item.off ? "border-line-strong" : "border-fg bg-fg text-bg")}>
                            {item.off ? null : <Check size={14} strokeWidth={3} />}
                          </span>
                        </button>
                        <div className={cn("min-w-0 flex-1 py-2", item.off && "text-fg-3 line-through")}>
                          <p className="text-[13px] tabular-nums text-fg-3">
                            {item.startTime}–{item.endTime} · {TRIP_CATEGORY_LABELS[item.category]}
                          </p>
                          <p className="text-[15px] font-medium">{item.title}</p>
                          {item.location ? <p className="truncate text-xs text-fg-3">{item.location}</p> : null}
                        </div>
                        <button
                          aria-expanded={editing === item.key}
                          aria-label={`${item.title} 고치기`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-fg-3 hover:bg-surface-2 hover:text-fg"
                          onClick={() => setEditing(editing === item.key ? null : item.key)}
                          type="button"
                        >
                          <Pencil size={16} />
                        </button>
                      </div>
                      {editing === item.key ? (
                        <div className="mb-2 ml-11 space-y-2 rounded-xl bg-surface-2 p-3">
                          <TextInput aria-label="제목" maxLength={120} onChange={(e) => editItem(item.key, { title: e.target.value })} value={item.title} />
                          <div className="grid grid-cols-2 gap-2">
                            <TextInput aria-label="시작" className="px-2.5 tabular-nums" onChange={(e) => editItem(item.key, { startTime: e.target.value })} type="time" value={item.startTime} />
                            <TextInput aria-label="끝" className="px-2.5 tabular-nums" onChange={(e) => editItem(item.key, { endTime: e.target.value })} type="time" value={item.endTime} />
                          </div>
                          {item.endTime <= item.startTime ? <p className="text-xs font-medium text-danger">끝나는 시각이 시작보다 늦어야 해요.</p> : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
              </fieldset>
            )}
            <RevisionChat busy={busy} locked={Boolean(revising)} onSend={revise} revisions={plan.revisions ?? []} />
            <div className="flex items-center justify-between px-1 text-sm text-fg-3">
              <span>
                {plan.attendees.length ? `함께 가는 사람 ${plan.attendees.map((a) => a.name ?? "알 수 없음").join(", ")}` : "혼자 가는 일정"}
              </span>
              <button className="h-11 rounded-xl px-2 font-semibold text-fg-2 hover:bg-surface-2" onClick={startOver} type="button">
                새로 만들기
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Entry point next to the "새 일정" form. */
export function PlanTripButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg" onClick={onClick} type="button">
      <Sparkles size={16} />
      AI 여행 일정
    </button>
  );
}
