"use client";

import { ASSISTANT_MESSAGE_MAX, ASSISTANT_TOOL_LABELS } from "@plandit/shared/assistant";
import { ArrowUp, Check, SquarePen } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatTime, isSameDay } from "@/lib/dates";
import type { Workspace } from "@/lib/types";

import { Button, cn, IconButton, Notice, Picker, Sheet, Spinner, TextInput } from "./ui";

type Preview = { calendar: string; title: string; start: string; end: string; location: string | null; attendees: string[] };
type Said = { type: "user"; id: string; text: string } | { type: "assistant"; id: string; text: string };
type Step = {
  type: "tool";
  id: string;
  name: string;
  status: "PENDING" | "WAITING_APPROVAL" | "DONE" | "ERROR" | "REJECTED";
  count: number | null;
  preview: Preview | null;
};
type Thread = { id: string; status: "IDLE" | "RUNNING" | "WAITING_APPROVAL"; stopCode: string | null; credits: number; items: Array<Said | Step> };

const threadsPath = (workspaceId: string) => `/workspaces/${workspaceId}/assistant/threads`;
const RESUME_KEY = "plandit-assistant-threads";
const SUGGESTIONS = ["내일 오후에 1시간 회의 잡아줘", "이번 주 일정 알려줘", "다음 주에 1시간 비는 시간 찾아줘"];
const COUNT_UNITS: Record<string, string> = { list_events: "개", find_free_slots: "곳", list_calendars: "개", list_members: "명" };
const STOPPED: Record<string, string> = {
  STEP_LIMIT: "단계가 길어져 여기서 멈췄어요. 이어서 말해 주세요.",
  INSUFFICIENT_CREDITS: "크레딧이 부족해 멈췄어요.",
  AI_MONTHLY_LIMIT: "이번 달 AI 사용 한도에 닿아 멈췄어요.",
  NOT_A_MEMBER: "이 워크스페이스의 멤버가 아니어서 멈췄어요.",
};
const stopMessage = (code: string) =>
  STOPPED[code] ?? (code.startsWith("LLM_") ? "AI가 답하지 못했어요. 실패한 호출의 크레딧은 돌려드렸어요." : "처리 중 문제가 생겨 멈췄어요. 다시 말해 주세요.");

/** The last conversation per workspace, so closing the sheet doesn't lose it */
function remembered(workspaceId: string): string | null {
  try {
    return (JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, string>)[workspaceId] ?? null;
  } catch {
    return null;
  }
}
function remember(workspaceId: string, threadId: string | null) {
  try {
    const all = JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, string>;
    if (threadId) all[workspaceId] = threadId;
    else delete all[workspaceId];
    window.localStorage.setItem(RESUME_KEY, JSON.stringify(all));
  } catch {
    // private mode: the conversation just isn't reopened
  }
}

const when = (start: string, end: string) =>
  isSameDay(new Date(start), new Date(end)) ? `${formatDateTime(start)} – ${formatTime(end)}` : `${formatDateTime(start)} – ${formatDateTime(end)}`;

/**
 * "AI 일정 비서": a chat in a sheet. The assistant reads the calendar with tools while the sheet polls; anything it
 * wants to create shows up as a card that needs "만들기". Credits are charged to the chosen workspace.
 */
export function AssistantSheet({ open, ...props }: { open: boolean; workspaces: Workspace[]; defaultWorkspaceId: string; onClose: () => void; onChanged: () => void }) {
  if (!open) return null;
  return <AssistantChat {...props} />;
}

function AssistantChat({ workspaces, defaultWorkspaceId, onClose, onChanged }: Omit<Parameters<typeof AssistantSheet>[0], "open">) {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const base = threadsPath(workspaceId);

  // Reopen this workspace's last conversation.
  useEffect(() => {
    setThread(null);
    setError(null);
    const id = remembered(workspaceId);
    if (!id) return;
    let live = true;
    api<Thread>(`${threadsPath(workspaceId)}/${id}`)
      .then((found) => live && setThread(found))
      .catch(() => remember(workspaceId, null));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  // While the assistant works: ask every 1.5 seconds.
  const running = thread?.status === "RUNNING";
  useEffect(() => {
    if (!running || !thread) return;
    const timer = setInterval(() => {
      api<Thread>(`${base}/${thread.id}`)
        .then(setThread)
        .catch(() => undefined); // a missed poll is retried on the next tick
    }, 1_500);
    return () => clearInterval(timer);
  }, [running, thread?.id, base]); // eslint-disable-line react-hooks/exhaustive-deps

  // A block body: newer browsers return a Promise from scrollIntoView, which React would take for a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.items.length, thread?.status]);

  async function send(message: string) {
    const body = message.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      let id = thread?.id;
      if (!id) {
        id = (await api<Thread>(base, { method: "POST" })).id;
        remember(workspaceId, id);
      }
      setThread(await api<Thread>(`${base}/${id}/messages`, { body: { text: body } }));
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(step: Step, approve: boolean) {
    if (!thread) return;
    setBusy(true);
    setError(null);
    try {
      setThread(await api<Thread>(`${base}/${thread.id}/tool-calls/${step.id}/${approve ? "approve" : "reject"}`, { method: "POST" }));
      if (approve) onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    remember(workspaceId, null);
    setThread(null);
    setText("");
    setError(null);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };

  const footer = (
    <div className="space-y-2">
      <form className="flex items-center gap-2" onSubmit={submit}>
        <TextInput
          aria-label="비서에게 보낼 메시지"
          disabled={running}
          enterKeyHint="send"
          maxLength={ASSISTANT_MESSAGE_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder={running ? "답을 기다리는 중이에요" : thread?.status === "WAITING_APPROVAL" ? "다른 요청을 보내면 이 제안은 넘어가요" : "예: 내일 오후에 1시간 회의 잡아줘"}
          value={text}
        />
        <IconButton className="bg-primary text-on-primary hover:bg-primary-strong hover:text-on-primary disabled:opacity-50" disabled={running || busy || !text.trim()} label="보내기" type="submit">
          {busy && !running ? <Spinner /> : <ArrowUp size={20} />}
        </IconButton>
      </form>
      <p className="text-center text-xs text-fg-3">{thread?.credits ? `이 대화에서 ${thread.credits.toLocaleString()} 크레딧 썼어요 · ` : ""}이 워크스페이스에서 AI 호출마다 쓴 만큼만 빠져요</p>
    </div>
  );

  return (
    <Sheet
      footer={footer}
      headerAction={
        thread ? (
          <IconButton label="새 대화" onClick={startOver}>
            <SquarePen size={18} />
          </IconButton>
        ) : undefined
      }
      onClose={onClose}
      open
      title="AI 일정 비서"
    >
      <div className="space-y-4">
        {workspaces.length > 1 ? (
          <div className="flex items-center gap-1 text-sm text-fg-3">
            <span>워크스페이스</span>
            <Picker label="워크스페이스" onChange={setWorkspaceId} options={workspaces.map((w) => ({ value: w.id, label: w.type === "PERSONAL" ? "개인" : w.name }))} value={workspaceId} variant="text" />
          </div>
        ) : null}

        {!thread?.items.length ? (
          <div className="space-y-3 py-2">
            <p className="text-[15px] leading-relaxed text-fg-2">일정을 확인하고, 비는 시간을 찾고, 일정을 만들어 드려요. 만드는 일정은 승인해야 캘린더에 들어가요.</p>
            <div className="flex flex-col items-start gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  className="min-h-11 rounded-xl bg-surface-2 px-3.5 text-left text-[15px] transition-colors hover:bg-surface-3 disabled:opacity-50"
                  disabled={busy}
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {thread.items.map((item) => (
              <li key={item.id}>
                {item.type === "user" ? (
                  <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[15px]">{item.text}</p>
                ) : item.type === "assistant" ? (
                  <p className="max-w-[92%] whitespace-pre-wrap break-words text-[15px] leading-relaxed">{item.text}</p>
                ) : item.preview ? (
                  <ChangeCard busy={busy} onDecide={(approve) => void decide(item, approve)} preview={item.preview} step={item} />
                ) : (
                  <ToolRow step={item} />
                )}
              </li>
            ))}
          </ol>
        )}

        {running ? (
          <p className="flex items-center gap-2 text-sm text-fg-3" role="status">
            <Spinner className="size-3.5" />
            확인하는 중이에요
          </p>
        ) : null}
        {thread?.status === "IDLE" && thread.stopCode ? (
          <Notice tone="info">
            {stopMessage(thread.stopCode)}{" "}
            {thread.stopCode === "INSUFFICIENT_CREDITS" || thread.stopCode === "AI_MONTHLY_LIMIT" ? (
              <Link className="underline" href="/credits">
                {thread.stopCode === "INSUFFICIENT_CREDITS" ? "충전하러 가기" : "한도 보기"}
              </Link>
            ) : null}
          </Notice>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <div ref={endRef} />
      </div>
    </Sheet>
  );
}

/** One read step, quietly: "일정 확인 · 3개" */
function ToolRow({ step }: { step: Step }) {
  const label = ASSISTANT_TOOL_LABELS[step.name] ?? step.name;
  return (
    <p className={cn("flex items-center gap-1.5 text-[13px]", step.status === "ERROR" ? "text-danger" : "text-fg-3")}>
      {step.status === "PENDING" ? <Spinner className="size-3" /> : step.status === "DONE" ? <Check size={14} /> : null}
      {label}
      {step.status === "DONE" && step.count !== null ? ` · ${step.count}${COUNT_UNITS[step.name] ?? "개"}` : ""}
      {step.status === "ERROR" ? " · 실패" : step.status === "REJECTED" ? " · 취소" : ""}
    </p>
  );
}

/** A change the assistant wants to make: nothing happens until "만들기". */
function ChangeCard({ step, preview, busy, onDecide }: { step: Step; preview: Preview; busy: boolean; onDecide: (approve: boolean) => void }) {
  const heading = { PENDING: "확인하는 중", WAITING_APPROVAL: "이 일정을 만들까요?", DONE: "만들었어요", ERROR: "만들지 못했어요", REJECTED: "만들지 않았어요" }[step.status];
  return (
    <div className={cn("rounded-2xl border p-4", step.status === "WAITING_APPROVAL" ? "border-fg" : "border-line")}>
      <p className={cn("flex items-center gap-1 text-[13px] font-semibold", step.status === "ERROR" ? "text-danger" : "text-fg-3")}>
        {step.status === "DONE" ? <Check size={14} /> : null}
        {heading}
      </p>
      <p className={cn("mt-1 text-[17px] font-bold", step.status === "REJECTED" && "text-fg-3 line-through")}>{preview.title}</p>
      <p className="text-[15px] tabular-nums text-fg-2">{when(preview.start, preview.end)}</p>
      <p className="text-sm text-fg-3">
        {preview.calendar}
        {preview.location ? ` · ${preview.location}` : ""}
      </p>
      {preview.attendees.length ? <p className="text-sm text-fg-3">참석 {preview.attendees.join(", ")}</p> : null}
      {step.status === "WAITING_APPROVAL" ? (
        <div className="mt-3 flex gap-2">
          <Button className="min-w-0 flex-1" disabled={busy} onClick={() => onDecide(false)} variant="secondary">
            거절
          </Button>
          <Button className="min-w-0 flex-1" loading={busy} onClick={() => onDecide(true)}>
            만들기
          </Button>
        </div>
      ) : null}
    </div>
  );
}
