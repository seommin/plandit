"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

type AuthMode = "login" | "signup";

const socialProviders = [
  {
    id: "google",
    label: "Google로 계속하기",
    className: "border border-[#dadce0] bg-white text-[#3c4043]",
    icon: <GoogleIcon />,
  },
  {
    id: "kakao",
    label: "카카오로 계속하기",
    className: "border border-[#FEE500] bg-[#FEE500] text-black",
    icon: <KakaoIcon />,
  },
  {
    id: "naver",
    label: "네이버로 계속하기",
    className: "border border-[#03C75A] bg-[#03C75A] text-white",
    icon: <NaverIcon />,
  },
] as const;

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
          <p className="mobile-brand-script text-[42px] leading-none">Plandit</p>
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

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--line)]" />
          <span className="text-xs font-semibold text-[var(--muted)]">또는</span>
          <div className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <div className="space-y-2">
          {socialProviders.map((provider) => (
            <button
              key={provider.id}
              className={[
                "flex h-11 w-full items-center justify-center gap-3 rounded-lg text-sm font-semibold",
                provider.className,
              ].join(" ")}
              onClick={() => signIn(provider.id)}
              type="button"
            >
              {provider.icon}
              {provider.label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path
        d="M12 4C6.9 4 2.75 7.17 2.75 11.08c0 2.5 1.7 4.7 4.26 5.96l-.73 2.68a.42.42 0 0 0 .64.46l3.18-2.1c.61.08 1.24.12 1.9.12 5.1 0 9.25-3.17 9.25-7.12S17.1 4 12 4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NaverIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path
        d="M14.7 12.45 9.02 4.5H4.5v15h4.8v-7.95l5.68 7.95h4.52v-15h-4.8v7.95Z"
        fill="currentColor"
      />
    </svg>
  );
}
