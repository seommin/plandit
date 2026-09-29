"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export default function InviteAcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function accept() {
    setSubmitting(true);
    setError(null);
    try {
      await api(`/invites/${token}/accept`, { method: "POST" });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button block loading={submitting} onClick={accept}>
        초대 수락
      </Button>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
