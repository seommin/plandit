"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") ?? ""), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setStatus("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setIsSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "재설정 링크가 만료되었거나 올바르지 않습니다.");
      setIsComplete(true);
      setStatus("비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.");
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
        <h1 className="text-lg font-semibold">새 비밀번호 설정</h1>
        {!isComplete ? (
          <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
            <input className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="새 비밀번호 (8자 이상)" required type="password" value={password} />
            <input className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3" minLength={8} onChange={(event) => setConfirmation(event.target.value)} placeholder="새 비밀번호 확인" required type="password" value={confirmation} />
            <button className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:opacity-55" disabled={isSubmitting || !token} type="submit">{isSubmitting ? "변경 중" : "비밀번호 변경"}</button>
          </form>
        ) : null}
        {status ? <p className="mt-4 rounded-lg bg-white p-3 text-sm">{status}</p> : null}
        <Link className="mt-5 block text-center text-sm font-semibold text-[var(--muted)]" href="/login">로그인으로 이동</Link>
      </section>
    </main>
  );
}
