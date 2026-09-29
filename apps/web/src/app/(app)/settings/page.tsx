"use client";

import { Bell, ChevronRight, LogOut, Plus, Users } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { type FormEvent, useEffect, useState } from "react";

import { type Theme, useApp } from "@/components/app-context";
import { CalendarSheet, NewCalendarSheet } from "@/components/calendar-sheet";
import { Button, Card, Field, Notice, SectionTitle, Segmented, Sheet, TextInput } from "@/components/ui";
import { ROLE_LABELS } from "@/components/workspace-switcher";
import { api, errorMessage } from "@/lib/client-api";
import type { Calendar } from "@/lib/types";

type Profile = { name: string | null; email: string; phone: string | null };
const formatPhone = (digits: string | null) => (digits ? digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : "");

export default function SettingsPage() {
  const { user, workspaces, workspace, reloadWorkspaces, theme, setTheme } = useApp();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [newCalendarOpen, setNewCalendarOpen] = useState(false);
  const [newTeamOpen, setNewTeamOpen] = useState(false);

  useEffect(() => {
    api<{ calendars: Calendar[] }>("/calendars")
      .then((r) => setCalendars(r.calendars))
      .catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 pb-8 lg:px-8">
      <h1 className="px-1 pt-4 text-[21px] font-bold tracking-tight lg:pt-8 lg:text-2xl">설정</h1>

      <ProfileSection fallbackName={user.name} />

      <section>
        <SectionTitle>화면</SectionTitle>
        <Card className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">테마</span>
          <Segmented<Theme>
            label="테마"
            onChange={setTheme}
            options={[
              { value: "system", label: "시스템" },
              { value: "light", label: "라이트" },
              { value: "dark", label: "다크" },
            ]}
            value={theme}
          />
        </Card>
      </section>

      <section>
        <SectionTitle
          action={
            <Button onClick={() => setNewTeamOpen(true)} size="sm" variant="ghost">
              <Plus size={16} />새 팀
            </Button>
          }
        >
          워크스페이스
        </SectionTitle>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link className="flex h-16 items-center gap-3 px-4 hover:bg-surface-2" href={`/settings/workspaces/${w.id}`}>
                <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-2">
                  <Users size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{w.name}</span>
                  <span className="block text-xs text-fg-3">
                    {w.type === "PERSONAL" ? "개인" : "팀"} · {ROLE_LABELS[w.role]}
                  </span>
                </span>
                <ChevronRight className="text-fg-3" size={18} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle
          action={
            <Button onClick={() => setNewCalendarOpen(true)} size="sm" variant="ghost">
              <Plus size={16} />새 캘린더
            </Button>
          }
        >
          캘린더
        </SectionTitle>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              <button className="flex h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2" onClick={() => setEditing(calendar)} type="button">
                <span className="size-3.5 rounded-full" style={{ backgroundColor: calendar.color }} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{calendar.name}</span>
                <span className="text-xs text-fg-3">{workspaces.find((w) => w.id === calendar.workspaceId)?.name}</span>
                <ChevronRight className="text-fg-3" size={18} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <PushSection />

      <Button block onClick={() => signOut({ callbackUrl: "/login" })} variant="secondary">
        <LogOut size={18} />
        로그아웃
      </Button>

      <CalendarSheet
        calendar={editing}
        currentUserId={user.id}
        onClose={() => setEditing(null)}
        onDeleted={(id) => {
          setCalendars((current) => current.filter((c) => c.id !== id));
          setEditing(null);
        }}
        onSaved={(saved) => setCalendars((current) => current.map((c) => (c.id === saved.id ? saved : c)))}
      />
      <NewCalendarSheet
        defaultWorkspaceId={workspace?.id}
        onClose={() => setNewCalendarOpen(false)}
        onCreated={(calendar) => setCalendars((current) => [...current, calendar])}
        open={newCalendarOpen}
        workspaces={workspaces}
      />
      <NewTeamSheet onClose={() => setNewTeamOpen(false)} onCreated={reloadWorkspaces} open={newTeamOpen} />
    </div>
  );
}

function ProfileSection({ fallbackName }: { fallbackName: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ user: Profile }>("/me")
      .then((r) => setProfile(r.user))
      .catch(() => undefined);
  }, []);

  async function savePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = String(new FormData(event.currentTarget).get("phone")).trim();
    setSaving(true);
    try {
      const r = await api<{ user: Profile }>("/me", { method: "PATCH", body: { phone: phone || null } });
      setProfile(r.user);
      setMessage({ tone: "success", text: phone ? "전화번호를 저장했어요." : "전화번호를 지웠어요." });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <SectionTitle>내 정보</SectionTitle>
      <Card className="space-y-4">
        <div>
          <p className="text-[17px] font-bold">{profile?.name ?? fallbackName}</p>
          <p className="text-sm text-fg-3">{profile?.email}</p>
        </div>
        <form className="space-y-2" key={profile?.phone ?? "none"} onSubmit={savePhone}>
          <Field hint="문자·알림톡 리마인더를 받을 번호예요. 실제 문자는 발송되지 않아요." label="휴대폰 번호">
            <div className="flex gap-2">
              <TextInput defaultValue={formatPhone(profile?.phone ?? null)} inputMode="tel" name="phone" placeholder="010-0000-0000" />
              <Button loading={saving} type="submit" variant="secondary">
                저장
              </Button>
            </div>
          </Field>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        </form>
      </Card>
    </section>
  );
}

function urlBase64ToUint8Array(value: string) {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (c) => c.charCodeAt(0));
}

function PushSection() {
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function register() {
    setBusy(true);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Web Push 공개 키가 설정되지 않았어요.");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("이 브라우저는 푸시 알림을 지원하지 않아요.");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("알림 권한을 허용해주세요.");
      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const keys = subscription.toJSON().keys;
      await api("/push/subscriptions", {
        body: { provider: "WEB_PUSH", endpoint: subscription.endpoint, deviceName: "이 브라우저", platform: "web", userAgent: navigator.userAgent, metadata: { auth: keys?.auth, p256dh: keys?.p256dh } },
      });
      setMessage({ tone: "success", text: "이 기기에서 푸시 알림을 받아요." });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api<{ sent: number; failed: number }>("/push/test", { body: { title: "Plandit", body: "푸시 알림이 연결됐어요.", url: "/" } });
      setMessage({ tone: r.sent ? "success" : "danger", text: `테스트 발송: 성공 ${r.sent} · 실패 ${r.failed}` });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <SectionTitle>알림</SectionTitle>
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-2">
            <Bell size={19} />
          </span>
          <div>
            <p className="text-[15px] font-semibold">푸시 알림</p>
            <p className="text-xs text-fg-3">리마인더를 푸시로 받으려면 이 기기를 등록하세요.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={register} variant="secondary">
            이 기기 등록
          </Button>
          <Button disabled={busy} onClick={test} variant="secondary">
            테스트 발송
          </Button>
        </div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </Card>
    </section>
  );
}

function NewTeamSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/workspaces", { body: { name: String(new FormData(event.currentTarget).get("name")).trim() } });
      await onCreated();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} open={open} title="새 팀 워크스페이스">
      <form className="space-y-4" onSubmit={submit}>
        <Field hint="팀원 초대, 공동 크레딧, 팀 캘린더를 쓸 수 있어요." label="팀 이름">
          <TextInput autoFocus maxLength={60} name="name" placeholder="예: 마케팅팀" required />
        </Field>
        {error ? <Notice>{error}</Notice> : null}
        <Button block loading={saving} type="submit">
          만들기
        </Button>
      </form>
    </Sheet>
  );
}
