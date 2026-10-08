"use client";

import { diffTripDraft, TRIP_CATEGORY_LABELS, TRIP_REVISION_MAX, type TripDraft } from "@plandit/shared/trips";
import { ArrowUp } from "lucide-react";
import { type FormEvent, useState } from "react";

import { WEEKDAYS } from "@/lib/dates";

import { Button, cn, IconButton, Spinner, TextInput } from "./ui";

export type Revision = {
  id: string;
  request: string;
  status: "PENDING" | "PROPOSED" | "ACCEPTED" | "DISCARDED" | "FAILED";
  failureCode: string | null;
  baseDraft?: TripDraft;
  proposedDraft?: TripDraft;
};

const STATUS: Record<Revision["status"], string> = {
  PENDING: "고치는 중",
  PROPOSED: "확인해 주세요",
  ACCEPTED: "반영했어요",
  DISCARDED: "반영 안 함",
  FAILED: "고치지 못했어요 · 크레딧은 돌려드렸어요",
};

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
};

/** "AI에게 고쳐 달라고 하기": what was asked so far, and the box to ask again (PLANDIT-27). */
export function RevisionChat({ revisions, busy, locked, onSend }: { revisions: Revision[]; busy: boolean; locked: boolean; onSend: (request: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && (await onSend(text.trim()))) setText("");
  };
  return (
    <section className="space-y-2 border-t border-line pt-4">
      <h3 className="px-1 text-[13px] font-semibold text-fg-3">AI에게 고쳐 달라고 하기</h3>
      {revisions.length ? (
        <ol className="space-y-2">
          {revisions.map((r) => (
            <li className="flex flex-col items-end gap-0.5" key={r.id}>
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-3.5 py-2 text-[15px]">{r.request}</p>
              <p className={cn("flex items-center gap-1 px-1 text-xs", r.status === "FAILED" ? "text-danger" : "text-fg-3")}>
                {r.status === "PENDING" ? <Spinner className="size-3" /> : null}
                {STATUS[r.status]}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-1 text-sm text-fg-3">예: 둘째 날 오후는 쉬게 해줘 · 첫째 날 저녁은 바다 보이는 곳으로</p>
      )}
      <form className="flex items-center gap-2" onSubmit={(e) => void submit(e)}>
        <TextInput
          aria-label="고쳐 달라고 할 내용"
          disabled={locked}
          maxLength={TRIP_REVISION_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder={locked ? "AI가 고치는 중이에요" : "어떻게 고칠까요?"}
          value={text}
        />
        <IconButton className="bg-primary text-on-primary hover:bg-primary-strong hover:text-on-primary disabled:opacity-50" disabled={locked || busy || !text.trim()} label="고쳐 달라고 하기" type="submit">
          {busy ? <Spinner /> : <ArrowUp size={20} />}
        </IconButton>
      </form>
    </section>
  );
}

/** A proposal against the draft it was made from: new and changed items marked, dropped ones struck through. */
export function RevisionPreview({ revision, busy, onDecide }: { revision: Revision; busy: boolean; onDecide: (accept: boolean) => void }) {
  if (!revision.baseDraft || !revision.proposedDraft) return null;
  const days = diffTripDraft(revision.baseDraft, revision.proposedDraft);
  const changes = days.reduce((n, d) => n + d.removed.length + d.items.filter((i) => i.change !== "same").length, 0);
  return (
    <section className="space-y-3 rounded-2xl border border-fg p-4">
      <div>
        <p className="text-[13px] font-semibold text-fg-3">AI가 고친 초안이에요</p>
        <p className="text-[15px] font-semibold">“{revision.request}”</p>
        <p className="text-sm text-fg-3">{changes ? `바뀐 곳 ${changes}군데 · 반영해야 초안이 바뀌어요` : "바뀐 곳이 없어요"}</p>
        {revision.proposedDraft.notes && revision.proposedDraft.notes !== revision.baseDraft.notes ? (
          <p className="mt-1 text-sm text-fg-2">{revision.proposedDraft.notes}</p>
        ) : null}
      </div>
      {days
        .filter((d) => d.removed.length || d.items.some((i) => i.change !== "same"))
        .map((day) => (
          <div key={day.date}>
            <h4 className="mb-1 text-[13px] font-semibold text-fg-3">{dayLabel(day.date)}</h4>
            <ul className="space-y-1">
              {day.items.map((item, i) => (
                <li className={cn("flex items-baseline gap-2 text-[14px]", item.change === "same" && "text-fg-3")} key={`n-${i}`}>
                  <span className="w-[86px] shrink-0 tabular-nums">
                    {item.startTime}–{item.endTime}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.title}
                    <span className="text-fg-3"> · {TRIP_CATEGORY_LABELS[item.category]}</span>
                  </span>
                  {item.change !== "same" ? <span className="shrink-0 rounded-md bg-surface-2 px-1.5 text-xs font-semibold">{item.change === "added" ? "새로" : "바뀜"}</span> : null}
                </li>
              ))}
              {day.removed.map((item, i) => (
                <li className="flex items-baseline gap-2 text-[14px] text-fg-3" key={`r-${i}`}>
                  <span className="w-[86px] shrink-0 tabular-nums line-through">
                    {item.startTime}–{item.endTime}
                  </span>
                  <span className="min-w-0 flex-1 truncate line-through">{item.title}</span>
                  <span className="shrink-0 text-xs">빠짐</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      <div className="flex gap-2">
        <Button className="min-w-0 flex-1" disabled={busy} onClick={() => onDecide(false)} variant="secondary">
          안 할래요
        </Button>
        <Button className="min-w-0 flex-1" loading={busy} onClick={() => onDecide(true)}>
          반영하기
        </Button>
      </div>
    </section>
  );
}
