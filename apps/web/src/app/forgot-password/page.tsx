"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [developmentResetUrl, setDevelopmentResetUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);
    setDevelopmentResetUrl(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { developmentResetUrl?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? "요청을 처리하지 못했습니다.");
      setStatus("가입된 이메일이라면 비밀번호 재설정 링크를 발송했습니다.");
      setDevelopmentResetUrl(result.developmentResetUrl ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4">
      <section className="panel w-full max-w-[420px] p-6">
        <p className="mobile-brand-script mb-7 text-center text-[42px] leading-none">Plandit</p>
        <h1 className="text-lg font-semibold">비밀번호 찾기</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">가입한 이메일을 입력하면 30분 동안 유효한 재설정 링크를 보내드립니다.</p>
        <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
          <input className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
          <button className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:opacity-55" disabled={isSubmitting} type="submit">
            {isSubmitting ? "처리 중" : "재설정 링크 받기"}
          </button>
        </form>
        {status ? <p className="mt-4 rounded-lg bg-white p-3 text-sm">{status}</p> : null}
        {developmentResetUrl ? <Link className="mt-3 block text-sm font-semibold underline" href={developmentResetUrl}>개발 환경 재설정 링크 열기</Link> : null}
        <Link className="mt-5 block text-center text-sm font-semibold text-[var(--muted)]" href="/login">로그인으로 돌아가기</Link>
      </section>
    </main>
  );
}
