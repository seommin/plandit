"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { type FormEvent, useEffect, useState } from "react";

import { AuthCard, safeCallbackUrl } from "@/components/auth-card";
import SocialLoginButtons from "@/components/social-login-buttons";
import { Button, Field, Notice, TextInput } from "@/components/ui";

// Public demo only (see .env.example). Unset → no demo button.
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL;
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD;

export default function LoginPage() {
  const [callbackUrl, setCallbackUrl] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setCallbackUrl(safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl"))), []);

  async function login(email: string, password: string) {
    setSubmitting(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("이메일 또는 비밀번호를 확인해주세요.");
      setSubmitting(false);
      return;
    }
    window.location.href = callbackUrl;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void login(String(data.get("email")), String(data.get("password")));
  }

  return (
    <AuthCard subtitle="개인 일정부터 팀 일정까지 한 곳에서">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="이메일">
          <TextInput autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
        </Field>
        <Field label="비밀번호">
          <TextInput autoComplete="current-password" minLength={8} name="password" placeholder="8자 이상" required type="password" />
        </Field>
        {error ? <Notice>{error}</Notice> : null}
        <Button block loading={submitting} type="submit">
          로그인
        </Button>
        {DEMO_EMAIL && DEMO_PASSWORD ? (
          <Button block disabled={submitting} onClick={() => login(DEMO_EMAIL, DEMO_PASSWORD)} variant="secondary">
            데모 계정으로 둘러보기
          </Button>
        ) : null}
      </form>

      <SocialLoginButtons callbackUrl={callbackUrl} />

      <div className="mt-6 flex items-center justify-center gap-3 text-sm font-semibold text-fg-3">
        <Link className="hover:text-fg" href="/forgot-password">
          비밀번호 찾기
        </Link>
        <span className="h-3 w-px bg-line" />
        <Link className="hover:text-fg" href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
          회원가입
        </Link>
      </div>
    </AuthCard>
  );
}
