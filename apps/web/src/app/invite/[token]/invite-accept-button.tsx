"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type InviteAcceptButtonProps = {
  token: string;
};

export default function InviteAcceptButton({ token }: InviteAcceptButtonProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function acceptInvite() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: string; message?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? result.error ?? "초대를 수락하지 못했습니다.");
      }

      router.push("/");
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white disabled:opacity-50"
        disabled={isSubmitting}
        onClick={acceptInvite}
        type="button"
      >
        {isSubmitting ? "수락 중" : "초대 수락"}
      </button>
      {error ? (
        <p className="rounded-lg bg-[#fff3f1] px-3 py-2 text-sm font-semibold text-[#b33a2f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
