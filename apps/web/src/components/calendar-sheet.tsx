"use client";

import { Check, Copy, UserMinus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/client-api";
import { type Calendar, type CalendarRole, canManage, type Workspace } from "@/lib/types";

import { Button, cn, Field, IconButton, Notice, Select, Sheet, TextArea, TextInput } from "./ui";

export const CALENDAR_COLORS = ["#3182F6", "#7257D6", "#03B26C", "#F04452", "#F59F00", "#00A6C7", "#EC5FA2", "#6B7684"];
const ROLE_LABEL: Record<CalendarRole, string> = { OWNER: "소유자", ADMIN: "관리", EDITOR: "편집", VIEWER: "보기" };

type Member = { id: string; role: CalendarRole; user: { id: string; name: string | null; email: string } };

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5" role="radiogroup">
      {CALENDAR_COLORS.map((color) => (
        <button
          aria-checked={value.toUpperCase() === color}
          aria-label={color}
          className="flex size-10 items-center justify-center rounded-full"
          key={color}
          onClick={() => onChange(color)}
          role="radio"
          style={{ backgroundColor: color }}
          type="button"
        >
          {value.toUpperCase() === color ? <Check className="text-white" size={18} strokeWidth={3} /> : null}
        </button>
      ))}
    </div>
  );
}

/** New calendar in one of my workspaces. */
export function NewCalendarSheet({ open, onClose, workspaces, defaultWorkspaceId, onCreated }: { open: boolean; onClose: () => void; workspaces: Workspace[]; defaultWorkspaceId?: string; onCreated: (calendar: Calendar) => void }) {
  const [color, setColor] = useState(CALENDAR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const workspace = workspaces.find((w) => w.id === data.get("workspaceId"));
    setSaving(true);
    setError(null);
    try {
      const { calendar } = await api<{ calendar: Calendar }>("/calendars", {
        body: { name: String(data.get("name")).trim(), color, workspaceId: workspace?.id, type: workspace?.type === "TEAM" ? "SHARED" : "PERSONAL" },
      });
      onCreated(calendar);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} open={open} title="새 캘린더">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="이름">
          <TextInput autoFocus maxLength={80} name="name" placeholder="예: 운동, 스터디" required />
        </Field>
        <Field label="워크스페이스">
          <Select defaultValue={defaultWorkspaceId} name="workspaceId">
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <span className="mb-2 block text-[13px] font-semibold text-fg-2">색상</span>
          <ColorPicker onChange={setColor} value={color} />
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <Button block loading={saving} type="submit">
          만들기
        </Button>
      </form>
    </Sheet>
  );
}

/** Edit a calendar, manage who can see it, invite people, or delete it. */
export function CalendarSheet({ calendar, currentUserId, onClose, onSaved, onDeleted }: { calendar: Calendar | null; currentUserId: string; onClose: () => void; onSaved: (calendar: Calendar) => void; onDeleted: (id: string) => void }) {
  return (
    <Sheet onClose={onClose} open={Boolean(calendar)} title={calendar?.name ?? ""}>
      {calendar ? <CalendarSettings calendar={calendar} currentUserId={currentUserId} key={calendar.id} onDeleted={onDeleted} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function CalendarSettings({ calendar, currentUserId, onSaved, onDeleted }: { calendar: Calendar; currentUserId: string; onSaved: (calendar: Calendar) => void; onDeleted: (id: string) => void }) {
  const manageable = canManage(calendar);
  const [color, setColor] = useState(calendar.color);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!manageable) return;
    api<{ members: Member[] }>(`/calendars/${calendar.id}/members`)
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, [calendar.id, manageable]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ calendar: Calendar }>(`/calendars/${calendar.id}`, {
        method: "PATCH",
        body: { name: String(data.get("name")).trim(), color, description: String(data.get("description") ?? "") || undefined },
      });
      onSaved({ ...calendar, ...result.calendar });
      setNotice("저장했어요.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setInviteUrl(null);
    try {
      const result = await api<{ status: "member" | "invited"; url?: string }>(`/calendars/${calendar.id}/invites`, {
        body: { email: String(data.get("email")), role: String(data.get("role")) },
      });
      if (result.status === "member") {
        setNotice("가입된 사용자라 바로 멤버로 추가했어요.");
        const r = await api<{ members: Member[] }>(`/calendars/${calendar.id}/members`);
        setMembers(r.members);
      } else {
        setNotice("초대 링크를 만들었어요. 링크를 전달해주세요.");
        setInviteUrl(result.url ?? null);
      }
      form.reset();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: Member, role: CalendarRole) {
    try {
      const r = await api<{ member: Member }>(`/calendars/${calendar.id}/members/${member.id}`, { method: "PATCH", body: { role } });
      setMembers((current) => current.map((m) => (m.id === member.id ? r.member : m)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`${member.user.name ?? member.user.email}님을 내보낼까요?`)) return;
    try {
      await api(`/calendars/${calendar.id}/members/${member.id}`, { method: "DELETE" });
      setMembers((current) => current.filter((m) => m.id !== member.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    if (!window.confirm(`'${calendar.name}' 캘린더와 그 안의 일정을 모두 삭제할까요?`)) return;
    try {
      await api(`/calendars/${calendar.id}`, { method: "DELETE" });
      onDeleted(calendar.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!manageable) return <Notice tone="info">이 캘린더는 {ROLE_LABEL[calendar.role]} 권한으로 참여 중이에요. 설정은 관리자만 바꿀 수 있어요.</Notice>;

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={save}>
        <Field label="이름">
          <TextInput defaultValue={calendar.name} maxLength={80} name="name" required />
        </Field>
        <div>
          <span className="mb-2 block text-[13px] font-semibold text-fg-2">색상</span>
          <ColorPicker onChange={setColor} value={color} />
        </div>
        <Field label="설명">
          <TextArea className="min-h-20" defaultValue={calendar.description ?? ""} maxLength={500} name="description" />
        </Field>
        <Button block loading={busy} type="submit">
          저장
        </Button>
      </form>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg-3">멤버 {members.length}명</h3>
        <ul className="divide-y divide-line rounded-2xl bg-surface-2">
          {members.map((member) => (
            <li className="flex items-center gap-2 px-3 py-2.5" key={member.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{member.user.name ?? member.user.email}</p>
                <p className="truncate text-xs text-fg-3">{member.user.email}</p>
              </div>
              {member.role === "OWNER" || member.user.id === currentUserId ? (
                <span className="text-xs font-semibold text-fg-3">{ROLE_LABEL[member.role]}</span>
              ) : (
                <>
                  <select
                    aria-label="권한"
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
                    onChange={(e) => changeRole(member, e.target.value as CalendarRole)}
                    value={member.role}
                  >
                    {(["ADMIN", "EDITOR", "VIEWER"] as const).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                  <IconButton className="text-danger hover:text-danger" label="내보내기" onClick={() => removeMember(member)}>
                    <UserMinus size={18} />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={invite}>
          <div className="min-w-0 flex-1">
            <TextInput aria-label="초대할 이메일" name="email" placeholder="초대할 이메일" required type="email" />
          </div>
          <div className="w-24 shrink-0">
            <Select aria-label="권한" defaultValue="VIEWER" name="role">
              <option value="VIEWER">보기</option>
              <option value="EDITOR">편집</option>
              <option value="ADMIN">관리</option>
            </Select>
          </div>
          <Button disabled={busy} type="submit" variant="secondary">
            초대
          </Button>
        </form>
        {inviteUrl ? (
          <button
            className="mt-2 flex w-full items-center gap-2 rounded-xl bg-primary-weak px-3 py-2.5 text-left text-xs text-primary"
            onClick={() => navigator.clipboard?.writeText(inviteUrl)}
            type="button"
          >
            <Copy className="shrink-0" size={14} />
            <span className="truncate">{inviteUrl}</span>
          </button>
        ) : null}
      </section>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}

      {!calendar.isDefault ? (
        <Button block className={cn("mt-2")} onClick={remove} variant="danger">
          캘린더 삭제
        </Button>
      ) : null}
    </div>
  );
}
