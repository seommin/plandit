import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { readInternalApi } from "@/lib/api-client";

import InviteAcceptButton from "./invite-accept-button";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

type InviteResponse = {
  invite: {
    id: string;
    email: string;
    role: "ADMIN" | "EDITOR" | "VIEWER";
    expiresAt: string;
    calendar: {
      id: string;
      name: string;
      color: string;
      type: "PERSONAL" | "SHARED" | "SUBSCRIBED";
    };
  };
};

const roleLabels = {
  ADMIN: "캘린더 관리 가능",
  EDITOR: "일정 편집 가능",
  VIEWER: "보기만 가능",
} satisfies Record<InviteResponse["invite"]["role"], string>;

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const session = await auth();
  const data = await readInternalApi<InviteResponse>(`/invites/${token}`).catch(() => null);

  if (!data) {
    notFound();
  }

  const isMatchingUser =
    session?.user?.email?.toLowerCase() === data.invite.email.toLowerCase();

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4">
      <section className="panel w-full max-w-[460px] p-6">
        <div className="mb-7 text-center">
          <p className="mobile-brand-script text-[42px] leading-none">Plandit</p>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <div className="mb-4 flex items-center gap-3">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: data.invite.calendar.color }}
            />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{data.invite.calendar.name}</h1>
              <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                공유 캘린더 초대
              </p>
            </div>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">초대 이메일</dt>
              <dd className="mt-1 font-semibold">{data.invite.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">권한</dt>
              <dd className="mt-1 font-semibold">{roleLabels[data.invite.role]}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-4">
          {session?.user?.id ? (
            isMatchingUser ? (
              <InviteAcceptButton token={token} />
            ) : (
              <p className="rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
                현재 로그인한 계정과 초대 이메일이 다릅니다.
              </p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link
                className="flex h-11 items-center justify-center rounded-lg bg-[var(--ink)] text-sm font-semibold text-white"
                href={`/login?callbackUrl=/invite/${token}`}
              >
                로그인
              </Link>
              <Link
                className="flex h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-sm font-semibold"
                href={`/signup?callbackUrl=/invite/${token}`}
              >
                회원가입
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
