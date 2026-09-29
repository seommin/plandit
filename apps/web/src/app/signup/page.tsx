"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { type FormEvent, useEffect, useState } from "react";

import { AuthCard, safeCallbackUrl } from "@/components/auth-card";
import SocialLoginButtons from "@/components/social-login-buttons";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export default function SignupPage() {
  const [callbackUrl, setCallbackUrl] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setCallbackUrl(safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl"))), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = { name: String(data.get("name")).trim(), email: String(data.get("email")), password: String(data.get("password")) };
    setSubmitting(true);
    setError(null);
    try {
      await api("/auth/register", { body });
      const result = await signIn("credentials", { email: body.email, password: body.password, redirect: false });
      if (result?.error) throw new Error("가입은 완료됐지만 로그인하지 못했어요. 로그인 화면에서 다시 시도해주세요.");
      window.location.href = callbackUrl;
    } catch (e) {
      setError((e as { status?: number }).status === 409 ? "이미 가입된 이메일이에요." : errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard subtitle="가입하면 개인 캘린더와 워크스페이스가 바로 만들어져요">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="이름">
          <TextInput autoComplete="name" maxLength={80} name="name" placeholder="홍길동" required />
        </Field>
        <Field label="이메일">
          <TextInput autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
        </Field>
        <Field hint="8자 이상" label="비밀번호">
          <TextInput autoComplete="new-password" maxLength={100} minLength={8} name="password" required type="password" />
        </Field>
        {error ? <Notice>{error}</Notice> : null}
        <Button block loading={submitting} type="submit">
          가입하기
        </Button>
      </form>
      <SocialLoginButtons callbackUrl={callbackUrl} />
      <p className="mt-6 text-center text-sm text-fg-3">
        이미 계정이 있나요?{" "}
        <Link className="font-semibold text-primary" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
          로그인
        </Link>
      </p>
    </AuthCard>
  );
}
