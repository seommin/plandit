"use client";

import { ChevronLeft, Copy, KeyRound, Pencil, Plus, UserMinus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { useApp } from "@/components/app-context";
import { Button, Card, Field, IconButton, Notice, SectionTitle, Select, Sheet, TextInput } from "@/components/ui";
import { ROLE_LABELS } from "@/components/workspace-switcher";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/dates";
import { isWorkspaceAdmin, type Page, type WorkspaceRole } from "@/lib/types";

type Member = { id: string; role: WorkspaceRole; user: { id: string; name: string | null; email: string } };
type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; owner?: { name: string | null; email: string } };
type AuditLog = { id: string; action: string; payload: Record<string, unknown> | null; createdAt: string; actor: { name: string | null; email: string } | null };

const RANK: Record<WorkspaceRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };
const SCOPES = [
  { value: "events:read", label: "일정 조회" },
  { value: "events:write", label: "일정 만들기" },
  { value: "credits:read", label: "크레딧 잔액 조회" },
];
const ACTIONS: Record<string, string> = {
  "workspace.created": "워크스페이스를 만들었어요",
  "workspace.renamed": "이름을 바꿨어요",
  "workspace.member_added": "멤버를 추가했어요",
  "workspace.member_role_changed": "멤버 역할을 바꿨어요",
  "workspace.member_removed": "멤버를 내보냈어요",
  "credit.adjusted": "크레딧을 조정했어요",
  "payment.approved": "충전이 완료됐어요",
  "payment.failed": "결제가 실패했어요",
  "payment.expired": "결제가 만료됐어요",
  "api_key.created": "API 키를 만들었어요",
  "api_key.revoked": "API 키를 폐기했어요",
};

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { user, workspaces, reloadWorkspaces } = useApp();
  const workspace = workspaces.find((w) => w.id === id);
  const admin = isWorkspaceAdmin(workspace);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const page = await api<Page<Member>>(`/workspaces/${id}/members?limit=100`);
      setMembers(page.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function changeRole(member: Member, role: WorkspaceRole) {
    try {
      await api(`/workspaces/${id}/members/${member.id}`, { method: "PATCH", body: { role } });
      await loadMembers();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(`${member.user.name ?? member.user.email}님을 내보낼까요?`)) return;
    try {
      await api(`/workspaces/${id}/members/${member.id}`, { method: "DELETE" });
      await loadMembers();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!workspace) return <p className="p-6 text-center text-sm text-fg-3">불러오는 중…</p>;
  const myRole = workspace.role;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 pb-8 lg:px-8">
      <header className="flex items-center gap-1 pt-3 lg:pt-7">
        <Link aria-label="설정으로" className="flex size-11 items-center justify-center rounded-xl text-fg-2 hover:bg-surface-2" href="/settings">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[21px] font-bold tracking-tight lg:text-2xl">{workspace.name}</h1>
        {admin ? (
          <IconButton label="이름 바꾸기" onClick={() => setRenameOpen(true)}>
            <Pencil size={18} />
          </IconButton>
        ) : null}
      </header>

      {error ? <Notice>{error}</Notice> : null}

      <section>
        <SectionTitle>멤버 {members.length}명</SectionTitle>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
          {members.map((member) => {
            // Same rule as the api: only roles at or below mine, never myself.
            const manageable = admin && member.user.id !== user.id && RANK[member.role] <= RANK[myRole];
            return (
              <li className="flex items-center gap-2 px-4 py-3" key={member.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">
                    {member.user.name ?? member.user.email}
                    {member.user.id === user.id ? <span className="ml-1 text-xs text-fg-3">나</span> : null}
                  </p>
                  <p className="truncate text-xs text-fg-3">{member.user.email}</p>
                </div>
                {manageable ? (
                  <>
                    <select aria-label="역할" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" onChange={(e) => changeRole(member, e.target.value as WorkspaceRole)} value={member.role}>
                      {(["OWNER", "ADMIN", "MEMBER"] as const)
                        .filter((role) => RANK[role] <= RANK[myRole])
                        .map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                    </select>
                    <IconButton className="text-danger hover:text-danger" label="내보내기" onClick={() => remove(member)}>
                      <UserMinus size={18} />
                    </IconButton>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-fg-3">{ROLE_LABELS[member.role]}</span>
                )}
              </li>
            );
          })}
        </ul>
        {admin && workspace.type === "TEAM" ? <InviteMember myRole={myRole} onAdded={loadMembers} workspaceId={id} /> : null}
        {workspace.type === "PERSONAL" ? <p className="mt-2 px-1 text-xs text-fg-3">개인 워크스페이스는 혼자 쓰는 공간이에요. 함께 쓰려면 설정에서 새 팀을 만드세요.</p> : null}
      </section>

      <ApiKeys admin={admin} workspaceId={id} />

      {admin ? <Activity workspaceId={id} /> : null}

      <Sheet onClose={() => setRenameOpen(false)} open={renameOpen} title="이름 바꾸기">
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/workspaces/${id}`, { method: "PATCH", body: { name: String(new FormData(event.currentTarget).get("name")).trim() } });
              await reloadWorkspaces();
              setRenameOpen(false);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          <TextInput defaultValue={workspace.name} maxLength={60} name="name" required />
          <Button block type="submit">
            저장
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

function InviteMember({ workspaceId, myRole, onAdded }: { workspaceId: string; myRole: WorkspaceRole; onAdded: () => Promise<void> }) {
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`/workspaces/${workspaceId}/members`, { body: { email: String(data.get("email")), role: String(data.get("role")) } });
      setMessage({ tone: "success", text: "멤버로 추가했어요." });
      form.reset();
      await onAdded();
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    }
  }

  return (
    <form className="mt-3 space-y-2" onSubmit={submit}>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <TextInput aria-label="추가할 멤버 이메일" name="email" placeholder="가입된 사용자의 이메일" required type="email" />
        </div>
        <div className="w-28 shrink-0">
          <Select aria-label="역할" defaultValue="MEMBER" name="role">
            {(["MEMBER", "ADMIN", "OWNER"] as const)
              .filter((role) => RANK[role] <= RANK[myRole])
              .map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          추가
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </form>
  );
}

function ApiKeys({ workspaceId, admin }: { workspaceId: string; admin: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const page = await api<Page<ApiKey>>(`/workspaces/${workspaceId}/api-keys?limit=100&order=desc`);
    setKeys(page.items);
  }, [workspaceId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const expires = Number(data.get("expiresInDays"));
    try {
      const result = await api<{ token: string }>(`/workspaces/${workspaceId}/api-keys`, {
        body: { name: String(data.get("name")).trim(), scopes: data.getAll("scopes"), ...(expires ? { expiresInDays: expires } : {}) },
      });
      setToken(result.token);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function revoke(key: ApiKey) {
    if (!window.confirm(`'${key.name}' 키를 폐기할까요? 이 키를 쓰는 연동이 바로 멈춰요.`)) return;
    try {
      await api(`/workspaces/${workspaceId}/api-keys/${key.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section>
      <SectionTitle
        action={
          <Button
            onClick={() => {
              setToken(null);
              setError(null);
              setOpen(true);
            }}
            size="sm"
            variant="ghost"
          >
            <Plus size={16} />새 키
          </Button>
        }
      >
        API 키 {admin ? "(전체)" : "(내 키)"}
      </SectionTitle>
      {keys.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
          {keys.map((key) => (
            <li className="flex items-center gap-3 px-4 py-3" key={key.id}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg-2">
                <KeyRound size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">
                  {key.name} <span className="font-mono text-xs text-fg-3">{key.prefix}…</span>
                </p>
                <p className="truncate text-xs text-fg-3">
                  {key.revokedAt ? "폐기됨" : key.lastUsedAt ? `최근 사용 ${formatDateTime(key.lastUsedAt)}` : "사용 전"}
                  {key.owner ? ` · ${key.owner.name ?? key.owner.email}` : ""}
                </p>
              </div>
              {key.revokedAt ? null : (
                <Button onClick={() => revoke(key)} size="sm" variant="danger">
                  폐기
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p className="text-sm text-fg-3">외부 스크립트나 연동에서 공개 API(/v1)를 쓰려면 키를 만드세요.</p>
        </Card>
      )}

      <Sheet onClose={() => setOpen(false)} open={open} title={token ? "키가 만들어졌어요" : "새 API 키"}>
        {token ? (
          <div className="space-y-3">
            <Notice tone="info">이 키는 지금만 볼 수 있어요. 안전한 곳에 복사해두세요.</Notice>
            <button className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-3 text-left font-mono text-sm" onClick={() => navigator.clipboard?.writeText(token)} type="button">
              <span className="min-w-0 flex-1 break-all">{token}</span>
              <Copy className="shrink-0 text-fg-3" size={16} />
            </button>
            <Button block onClick={() => setOpen(false)}>
              완료
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={create}>
            <Field label="이름">
              <TextInput maxLength={60} name="name" placeholder="예: 사내 봇" required />
            </Field>
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-fg-2">권한</legend>
              <div className="space-y-1">
                {SCOPES.map((scope) => (
                  <label className="flex h-11 items-center gap-3 rounded-xl px-2 hover:bg-surface-2" key={scope.value}>
                    <input className="size-5 accent-[var(--primary)]" defaultChecked={scope.value === "events:read"} name="scopes" type="checkbox" value={scope.value} />
                    <span className="text-[15px]">{scope.label}</span>
                    <span className="ml-auto font-mono text-xs text-fg-3">{scope.value}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="만료">
              <Select defaultValue="90" name="expiresInDays">
                <option value="30">30일</option>
                <option value="90">90일</option>
                <option value="365">1년</option>
                <option value="">만료 없음</option>
              </Select>
            </Field>
            {error ? <Notice>{error}</Notice> : null}
            <Button block type="submit">
              만들기
            </Button>
          </form>
        )}
      </Sheet>
    </section>
  );
}

function Activity({ workspaceId }: { workspaceId: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => {
    api<Page<AuditLog>>(`/workspaces/${workspaceId}/audit-logs?limit=20`)
      .then((page) => setLogs(page.items))
      .catch(() => undefined);
  }, [workspaceId]);

  return (
    <section>
      <SectionTitle>활동 기록</SectionTitle>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
        {logs.length ? (
          logs.map((log) => (
            <li className="px-4 py-3" key={log.id}>
              <p className="text-[15px] font-medium">
                <span className="font-semibold">{log.actor?.name ?? log.actor?.email ?? "시스템"}</span>
                <span className="text-fg-2"> · {ACTIONS[log.action] ?? log.action}</span>
              </p>
              <p className="text-xs text-fg-3">{formatDateTime(log.createdAt)}</p>
            </li>
          ))
        ) : (
          <li className="px-4 py-6 text-center text-sm text-fg-3">아직 기록이 없어요.</li>
        )}
      </ul>
    </section>
  );
}
