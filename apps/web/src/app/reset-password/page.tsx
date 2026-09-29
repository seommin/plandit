"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") ?? ""), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (password !== data.get("confirmation")) return setError("비밀번호가 서로 달라요.");
    setSubmitting(true);
    setError(null);
    try {
      await api("/auth/reset-password", { body: { token, password } });
      setDone(true);
    } catch (e) {
      setError((e as { status?: number }).status === 400 ? "링크가 만료됐거나 올바르지 않아요. 다시 요청해주세요." : errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard subtitle="새 비밀번호를 정해주세요">
      {done ? (
        <div className="space-y-4">
          <Notice tone="success">비밀번호를 바꿨어요. 새 비밀번호로 로그인하세요.</Notice>
          <Link className="flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-on-primary" href="/login">
            로그인
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field hint="8자 이상" label="새 비밀번호">
            <TextInput autoComplete="new-password" maxLength={100} minLength={8} name="password" required type="password" />
          </Field>
          <Field label="새 비밀번호 확인">
            <TextInput autoComplete="new-password" maxLength={100} minLength={8} name="confirmation" required type="password" />
          </Field>
          {!token ? <Notice>재설정 링크가 올바르지 않아요.</Notice> : null}
          {error ? <Notice>{error}</Notice> : null}
          <Button block disabled={!token} loading={submitting} type="submit">
            비밀번호 바꾸기
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
