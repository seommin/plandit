"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

type AuthMode = "login" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login");
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
      if (mode === "signup") {
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
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error("이메일 또는 비밀번호를 확인해주세요.");
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
          <p className="mobile-brand-script text-[38px] leading-none">Plandit</p>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {mode === "login" ? "계정으로 계속하기" : "새 계정 만들기"}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-lg border border-[var(--line)] bg-white p-1">
          {[
            ["login", "로그인"],
            ["signup", "회원가입"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={[
                "h-9 rounded-md text-sm font-semibold",
                mode === value ? "bg-[var(--ink)] text-white" : "text-[#34362f]",
              ].join(" ")}
              onClick={() => {
                setMode(value as AuthMode);
                setStatus(null);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <input
              className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
              name="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="이름"
              required
              type="text"
              value={name}
            />
          ) : null}
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
            {isSubmitting ? "처리 중" : mode === "login" ? "로그인" : "가입하고 시작하기"}
          </button>
        </form>

        {status ? (
          <p className="mt-3 rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
            {status}
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            ["google", "Google"],
            ["kakao", "Kakao"],
            ["naver", "Naver"],
          ].map(([provider, label]) => (
            <button
              key={provider}
              className="h-10 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold"
              onClick={() => signIn(provider)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
