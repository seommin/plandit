"use client";

import { ArrowDownLeft, ArrowUpRight, Coins, MessageSquare, Plus, Receipt, RotateCcw, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { useApp } from "@/components/app-context";
import { Button, Card, cn, EmptyState, Field, Notice, Segmented, Sheet, TextInput } from "@/components/ui";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/dates";
import { isWorkspaceAdmin, type Page } from "@/lib/types";

const CREDIT_PRICE = 10; // KRW per credit (packages/shared/credits)
const PRESETS = [10_000, 30_000, 50_000, 100_000];
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

type Balance = { accountId: string; balance: number };
type LedgerEntry = { id: string; type: "CHARGE" | "DEBIT" | "REFUND" | "ADJUST"; amount: number; balanceAfter: number; refType: string; memo: string | null; createdAt: string };
type Payment = { id: string; tradeId: string; status: "RESERVE" | "APPROVED" | "FAILED" | "CANCELED" | "UNKNOWN"; amount: number; credits: number; failureCode: string | null; createdAt: string };
type Delivery = {
  id: string;
  channel: "PUSH" | "SMS" | "ALIMTALK";
  status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "SKIPPED";
  credits: number;
  failCode: string | null;
  refunded: boolean;
  queuedAt: string;
  user: { name: string | null };
  reminder: { event: { title: string } } | null;
};

const LEDGER_LABEL = { CHARGE: "충전", DEBIT: "사용", REFUND: "환불", ADJUST: "조정" };
const LEDGER_REF: Record<string, string> = { PAYMENT: "크레딧 충전", REMINDER_DELIVERY: "리마인더 발송", AI_USAGE: "AI 사용", MANUAL: "운영자 조정" };
const PAYMENT_STATUS = {
  RESERVE: { label: "결제 대기", tone: "neutral" },
  UNKNOWN: { label: "확인 중", tone: "warning" },
  APPROVED: { label: "완료", tone: "success" },
  FAILED: { label: "실패", tone: "danger" },
  CANCELED: { label: "취소", tone: "neutral" },
} as const;
const DELIVERY_STATUS = {
  QUEUED: { label: "대기", tone: "neutral" },
  SENT: { label: "발송 중", tone: "warning" },
  DELIVERED: { label: "전달", tone: "success" },
  FAILED: { label: "실패", tone: "danger" },
  SKIPPED: { label: "건너뜀", tone: "neutral" },
} as const;
const CHANNEL_LABEL = { PUSH: "푸시", SMS: "문자", ALIMTALK: "알림톡" };

type Tab = "ledger" | "payments" | "deliveries";

export default function CreditsPage() {
  const { workspace } = useApp();
  const admin = isWorkspaceAdmin(workspace);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ledger");

  useEffect(() => {
    if (!workspace) return;
    setBalance(null);
    api<Balance>(`/workspaces/${workspace.id}/credits`)
      .then(setBalance)
      .catch((e) => setError(errorMessage(e)));
  }, [workspace]);

  return (
    <div className="mx-auto max-w-2xl px-3 lg:px-8">
      <header className="flex items-center gap-2 pb-3 pt-3 lg:pt-7">
        <WorkspaceSwitcher />
      </header>

      {error ? <Notice>{error}</Notice> : null}

      <Card className="p-5">
        <p className="text-[13px] font-semibold text-fg-3">보유 크레딧</p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[34px] font-bold tracking-tight tabular-nums">{balance ? balance.balance.toLocaleString("ko-KR") : "–"}</span>
          <span className="text-base font-semibold text-fg-2">크레딧</span>
        </p>
        <p className="mt-1 text-sm text-fg-3">문자 알림 {balance ? balance.balance.toLocaleString("ko-KR") : "–"}건 · 1크레딧 = {CREDIT_PRICE}원</p>
        {admin ? (
          <Button block className="mt-4" onClick={() => setChargeOpen(true)}>
            <Plus size={18} />
            충전하기
          </Button>
        ) : (
          <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-fg-2">충전과 사용 내역은 워크스페이스 관리자만 볼 수 있어요.</p>
        )}
      </Card>

      {admin && workspace ? (
        <section className="mt-6 pb-6">
          <Segmented
            label="내역"
            onChange={setTab}
            options={[
              { value: "ledger", label: "사용 내역" },
              { value: "payments", label: "결제" },
              { value: "deliveries", label: "알림 발송" },
            ]}
            value={tab}
          />
          <div className="mt-3">
            {tab === "ledger" ? (
              <CursorList<LedgerEntry> empty="아직 내역이 없어요." icon={<Receipt size={22} />} key={`l-${workspace.id}`} path={`/workspaces/${workspace.id}/credits/ledger`} render={(e) => <LedgerRow entry={e} key={e.id} />} />
            ) : tab === "payments" ? (
              <CursorList<Payment> empty="결제 내역이 없어요." icon={<Coins size={22} />} key={`p-${workspace.id}`} path={`/workspaces/${workspace.id}/payments?order=desc`} render={(p) => <PaymentRow key={p.id} payment={p} />} />
            ) : (
              <CursorList<Delivery> empty="발송한 알림이 없어요." icon={<MessageSquare size={22} />} key={`d-${workspace.id}`} path={`/workspaces/${workspace.id}/reminder-deliveries`} render={(d) => <DeliveryRow delivery={d} key={d.id} />} />
            )}
          </div>
        </section>
      ) : null}

      {workspace ? <ChargeSheet onClose={() => setChargeOpen(false)} open={chargeOpen} workspaceId={workspace.id} /> : null}
    </div>
  );
}

/** Loads a cursor-paginated endpoint 20 at a time with a "더 보기" button. */
function CursorList<T>({ path, render, empty, icon }: { path: string; render: (item: T) => React.ReactNode; empty: string; icon: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      try {
        const sep = path.includes("?") ? "&" : "?";
        const page = await api<Page<T>>(`${path}${sep}limit=20${after ? `&cursor=${after}` : ""}`);
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (error) return <Notice>{error}</Notice>;
  if (!loading && !items.length) return <Card><EmptyState icon={icon} title={empty} /></Card>;

  return (
    <div className="space-y-2">
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">{items.map(render)}</div>
      {cursor ? (
        <Button block loading={loading} onClick={() => load(cursor)} variant="secondary">
          더 보기
        </Button>
      ) : loading ? (
        <p className="py-4 text-center text-sm text-fg-3">불러오는 중…</p>
      ) : null}
    </div>
  );
}

function Badge({ tone, children }: { tone: "neutral" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const tones = { neutral: "bg-surface-2 text-fg-2", success: "bg-success-weak text-success", warning: "bg-warning-weak text-warning", danger: "bg-danger-weak text-danger" };
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold", tones[tone])}>{children}</span>;
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const positive = entry.amount > 0;
  const Icon = entry.type === "REFUND" ? RotateCcw : entry.type === "ADJUST" ? SlidersHorizontal : positive ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", positive ? "bg-primary-weak text-primary" : "bg-surface-2 text-fg-2")}>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{entry.memo ?? LEDGER_REF[entry.refType] ?? LEDGER_LABEL[entry.type]}</p>
        <p className="text-xs text-fg-3">
          {LEDGER_LABEL[entry.type]} · {formatDateTime(entry.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p className={cn("text-[15px] font-bold tabular-nums", positive ? "text-primary" : "text-fg")}>
          {positive ? "+" : ""}
          {entry.amount.toLocaleString("ko-KR")}
        </p>
        <p className="text-xs tabular-nums text-fg-3">잔액 {entry.balanceAfter.toLocaleString("ko-KR")}</p>
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  const status = PAYMENT_STATUS[payment.status];
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          {won(payment.amount)} <Badge tone={status.tone}>{status.label}</Badge>
        </p>
        <p className="truncate text-xs text-fg-3">
          {payment.tradeId} · {formatDateTime(payment.createdAt)}
          {payment.failureCode ? ` · ${payment.failureCode}` : ""}
        </p>
      </div>
      <p className="text-[15px] font-bold tabular-nums text-fg-2">+{payment.credits.toLocaleString("ko-KR")}</p>
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: Delivery }) {
  const status = DELIVERY_STATUS[delivery.status];
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="truncate">{delivery.reminder?.event.title ?? "삭제된 일정"}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </p>
        <p className="truncate text-xs text-fg-3">
          {CHANNEL_LABEL[delivery.channel]} · {delivery.user.name ?? "사용자"} · {formatDateTime(delivery.queuedAt)}
          {delivery.failCode ? ` · ${delivery.failCode}` : ""}
        </p>
      </div>
      <p className="text-right text-xs font-semibold text-fg-3">
        {delivery.credits ? `${delivery.credits}크레딧` : "무료"}
        {delivery.refunded ? <span className="block text-primary">환불됨</span> : null}
      </p>
    </div>
  );
}

function ChargeSheet({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId: string }) {
  const [amount, setAmount] = useState(PRESETS[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { payment } = await api<{ payment: { paymentPageUrl: string } }>(`/workspaces/${workspaceId}/payments/charge`, { body: { amount } });
      window.location.href = payment.paymentPageUrl; // the (mock) PG's hosted payment page
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <Sheet onClose={onClose} open={open} title="크레딧 충전">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <button
              className={cn("h-14 rounded-xl text-[15px] font-semibold transition-colors", amount === preset ? "bg-primary text-on-primary" : "bg-surface-2 hover:bg-surface-3")}
              key={preset}
              onClick={() => setAmount(preset)}
              type="button"
            >
              {won(preset)}
            </button>
          ))}
        </div>
        <Field hint="1,000원 ~ 1,000,000원" label="직접 입력">
          <TextInput inputMode="numeric" max={1_000_000} min={1_000} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")))} type="number" value={amount || ""} />
        </Field>
        <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
          <span className="text-sm text-fg-2">받는 크레딧</span>
          <span className="text-lg font-bold tabular-nums">{Math.floor(amount / CREDIT_PRICE).toLocaleString("ko-KR")} 크레딧</span>
        </div>
        <details className="rounded-xl bg-primary-weak px-4 py-3 text-sm text-fg-2">
          <summary className="cursor-pointer font-semibold text-primary">테스트 결제 안내</summary>
          <p className="mt-2">실제 결제는 일어나지 않아요. 금액 끝 두 자리로 상황을 재현할 수 있어요.</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>…00 정상 승인</li>
            <li>…01 승인 실패</li>
            <li>…03 결제 알림 2번 전송 (크레딧은 한 번만)</li>
            <li>…05 결제 알림 누락 (재조회로 확정)</li>
          </ul>
        </details>
        {error ? <Notice>{error}</Notice> : null}
        <Button block disabled={amount < 1_000 || amount > 1_000_000} loading={submitting} type="submit">
          {won(amount || 0)} 결제하기
        </Button>
      </form>
    </Sheet>
  );
}
