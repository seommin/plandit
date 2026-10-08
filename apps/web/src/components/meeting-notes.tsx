"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/client-api";

import { IconButton, Notice, Spinner } from "./ui";

type Note = { id: string; filename: string; sizeBytes: number; status: "PROCESSING" | "READY" };

const MAX_BYTES = 5 * 1024 * 1024;
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`);

/**
 * Meeting notes on an existing event (PLANDIT-22): attach a PDF/TXT/MD, see it become searchable, remove it.
 * Only the text is kept; the AI assistant can then answer "what did we decide?" from it.
 */
export function MeetingNotes({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const path = `/events/${eventId}/documents`;

  const load = useCallback(() => api<{ items: Note[] }>(path).then((r) => setNotes(r.items)), [path]);

  useEffect(() => {
    load().catch(() => setNotes([]));
  }, [load]);

  // While a note is being made searchable, look again every 3 seconds.
  const processing = notes?.some((n) => n.status === "PROCESSING");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load().catch(() => undefined), 3_000);
    return () => clearInterval(timer);
  }, [processing, load]);

  async function attach(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) return setError("5MB보다 큰 파일은 올릴 수 없어요.");
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const created = await api<Note>(path, { body: form });
      setNotes((current) => [created, ...(current ?? [])]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(note: Note) {
    setError(null);
    try {
      await api(`${path}/${note.id}`, { method: "DELETE" });
      setNotes((current) => current?.filter((n) => n.id !== note.id) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!notes || (!notes.length && !canEdit)) return null;
  return (
    <div className="flex gap-3 border-t border-line pt-1">
      <span className="flex h-11 w-5 shrink-0 items-center justify-center text-fg-3">
        <FileText size={18} />
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <ul>
          {notes.map((note) => (
            <li className="flex min-h-11 items-center gap-2" key={note.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{note.filename}</p>
                <p className="flex items-center gap-1.5 text-xs text-fg-3">
                  {note.status === "PROCESSING" ? <Spinner className="size-3" /> : null}
                  {size(note.sizeBytes)} · {note.status === "PROCESSING" ? "검색 준비 중" : "AI 비서가 찾아볼 수 있어요"}
                </p>
              </div>
              {canEdit ? (
                <IconButton label={`${note.filename} 삭제`} onClick={() => void remove(note)}>
                  <Trash2 size={16} />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <>
            <input accept=".pdf,.txt,.md" className="hidden" onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} ref={input} type="file" />
            <button
              className="flex h-11 items-center gap-1.5 text-[15px] text-fg-2 hover:text-fg disabled:opacity-50"
              disabled={busy}
              onClick={() => input.current?.click()}
              type="button"
            >
              {busy ? <Spinner /> : <Paperclip size={16} />}
              회의록 첨부
            </button>
            {!notes.length ? <p className="pb-1 text-xs text-fg-3">PDF·TXT·MD, 5MB까지. 글자만 저장하고 원본 파일은 보관하지 않아요.</p> : null}
          </>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
      </div>
    </div>
  );
}
