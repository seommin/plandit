import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AuthCard } from "@/components/auth-card";
import { Notice } from "@/components/ui";
import { readInternalApi } from "@/lib/api-client";

import InviteAcceptButton from "./invite-accept-button";

type InviteResponse = {
  invite: {
    email: string;
    role: "ADMIN" | "EDITOR" | "VIEWER";
    calendar: { name: string; color: string };
  };
};

const ROLE_LABELS = { ADMIN: "캘린더 관리", EDITOR: "일정 편집", VIEWER: "보기" } as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  const data = await readInternalApi<InviteResponse>(`/invites/${token}`).catch(() => null);
  if (!data) notFound();

  const { invite } = data;
  const matches = session?.user?.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <AuthCard subtitle="공유 캘린더에 초대받았어요">
      <div className="mb-5 rounded-2xl bg-surface-2 p-4">
        <p className="flex items-center gap-2 text-lg font-bold">
          <span className="size-3 rounded-full" style={{ backgroundColor: invite.calendar.color }} />
          {invite.calendar.name}
        </p>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-fg-3">받는 사람</dt>
            <dd className="font-semibold">{invite.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-3">권한</dt>
            <dd className="font-semibold">{ROLE_LABELS[invite.role]}</dd>
          </div>
        </dl>
      </div>

      {session?.user?.id ? (
        matches ? (
          <InviteAcceptButton token={token} />
        ) : (
          <Notice>지금 로그인한 계정({session.user.email})과 초대받은 이메일이 달라요.</Notice>
        )
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Link className="flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-on-primary" href={`/login?callbackUrl=/invite/${token}`}>
            로그인
          </Link>
          <Link className="flex h-12 items-center justify-center rounded-xl bg-surface-2 text-[15px] font-semibold" href={`/signup?callbackUrl=/invite/${token}`}>
            회원가입
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
