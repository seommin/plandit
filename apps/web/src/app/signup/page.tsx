"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

import SocialLoginButtons from "@/components/social-login-buttons";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, email, password }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "회원가입에 실패했습니다.");
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error("가입은 완료됐지만 로그인에 실패했습니다.");
      }

      window.location.href = "/";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4">
      <section className="panel w-full max-w-[420px] p-6">
        <div className="mb-7 text-center">
          <p className="mobile-brand-script text-[42px] leading-none">Plandit</p>
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <input
            className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
            name="name"
            onChange={(event) => setName(event.target.value)}
            placeholder="이름"
            required
            type="text"
            value={name}
          />
          <input
            className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
          <input
            className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="password"
            required
            type="password"
            value={password}
          />
          <button
            className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "처리 중" : "회원가입"}
          </button>
        </form>

        {status ? (
          <p className="mt-3 rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
            {status}
          </p>
        ) : null}

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--line)]" />
          <span className="text-xs font-semibold text-[var(--muted)]">또는</span>
          <div className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <SocialLoginButtons />

        <div className="mt-5 text-center text-sm font-semibold text-[var(--muted)]">
          <Link className="hover:text-[var(--ink)]" href="/login">
            이미 계정이 있나요?
          </Link>
        </div>
      </section>
    </main>
  );
}
