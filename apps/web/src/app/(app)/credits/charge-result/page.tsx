"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Card, Spinner } from "@/components/ui";
import { api } from "@/lib/client-api";

type Payment = { status: "RESERVE" | "APPROVED" | "FAILED" | "CANCELED" | "UNKNOWN"; amount: number; credits: number; failureCode: string | null };

const FAILURES: Record<string, string> = {
  CARD_DECLINED: "카드사에서 승인을 거절했어요.",
  USER_CANCELED: "결제를 취소했어요.",
  PG_REJECTED: "결제 요청이 거절됐어요.",
  EXPIRED: "결제 시간이 지났어요.",
};

/**
 * Where the PG sends the browser back. The redirect itself proves nothing (anyone can craft it): credits are
 * granted only by the PG webhook or the re-query job, so this page just waits for the server-side status.
 */
function ChargeResult() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId");
  const paymentId = params.get("paymentId");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!workspaceId || !paymentId) return;
    let stopped = false;
    const started = Date.now();
    const poll = async () => {
      if (stopped) return;
      try {
        const { payment: current } = await api<{ payment: Payment }>(`/workspaces/${workspaceId}/payments/${paymentId}`);
        setPayment(current);
        if (current.status === "APPROVED" || current.status === "FAILED" || current.status === "CANCELED") return;
      } catch {
        // keep polling
      }
      if (Date.now() - started > 15_000) return setTimedOut(true);
      setTimeout(poll, 1_000);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [workspaceId, paymentId]);

  const done = payment?.status === "APPROVED";
  const failed = payment?.status === "FAILED" || payment?.status === "CANCELED";

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4">
      <Card className="p-6 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl bg-surface-2">
          {done ? <CheckCircle2 className="text-success" size={34} /> : failed ? <XCircle className="text-danger" size={34} /> : timedOut ? <Clock className="text-warning" size={32} /> : <Spinner className="size-7 text-primary" />}
        </div>
        <h1 className="text-xl font-bold">{done ? "충전 완료" : failed ? "결제 실패" : timedOut ? "확인이 늦어지고 있어요" : "결제를 확인하고 있어요"}</h1>
        <p className="mt-2 text-[15px] text-fg-2">
          {done
            ? `${payment.credits.toLocaleString("ko-KR")} 크레딧이 들어왔어요.`
            : failed
              ? (payment.failureCode && FAILURES[payment.failureCode]) ?? "결제가 완료되지 않았어요."
              : timedOut
                ? "결제사 확인이 끝나는 대로 자동으로 반영돼요. 두 번 결제하지 않아도 돼요."
                : "잠시만 기다려주세요."}
        </p>
        <Link className="mt-6 flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-on-primary" href="/credits">
          크레딧으로 돌아가기
        </Link>
      </Card>
    </div>
  );
}

export default function ChargeResultPage() {
  return (
    <Suspense>
      <ChargeResult />
    </Suspense>
  );
}
