"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ developmentResetUrl?: string }>("/auth/forgot-password", { body: { email: String(new FormData(event.currentTarget).get("email")) } });
      setSent(true);
      setDevUrl(result.developmentResetUrl ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard subtitle="가입한 이메일로 재설정 링크를 보내드려요">
      {sent ? (
        <div className="space-y-4">
          <Notice tone="success">가입된 이메일이라면 비밀번호 재설정 링크를 보냈어요.</Notice>
          {devUrl ? (
            <a className="block break-all rounded-xl bg-surface-2 p-3 text-xs text-primary" href={devUrl}>
              개발 환경 링크: {devUrl}
            </a>
          ) : null}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field label="이메일">
            <TextInput autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
          </Field>
          {error ? <Notice>{error}</Notice> : null}
          <Button block loading={submitting} type="submit">
            재설정 링크 받기
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link className="font-semibold text-primary" href="/login">
          로그인으로 돌아가기
        </Link>
      </p>
    </AuthCard>
  );
}
