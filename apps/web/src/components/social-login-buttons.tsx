"use client";

import { getProviders, signIn } from "next-auth/react";
import { useEffect, useState } from "react";

const PROVIDERS = [
  { id: "google", label: "Google로 계속하기", className: "border border-line bg-surface text-fg", icon: <GoogleIcon /> },
  { id: "kakao", label: "카카오로 계속하기", className: "bg-[#FEE500] text-black", icon: <KakaoIcon /> },
  { id: "naver", label: "네이버로 계속하기", className: "bg-[#03C75A] text-white", icon: <NaverIcon /> },
] as const;

/** Only the OAuth providers configured on the server (AUTH_*_ID) are shown. */
export default function SocialLoginButtons({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => {
    getProviders()
      .then((providers) => setAvailable(Object.keys(providers ?? {})))
      .catch(() => setAvailable([]));
  }, []);

  const shown = PROVIDERS.filter((p) => available.includes(p.id));
  if (!shown.length) return null;

  return (
    <>
      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs font-semibold text-fg-3">또는</span>
        <div className="h-px flex-1 bg-line" />
      </div>
      <div className="space-y-2">
        {shown.map((provider) => (
          <button
            className={`flex h-12 w-full items-center justify-center gap-3 rounded-xl text-[15px] font-semibold ${provider.className}`}
            key={provider.id}
            onClick={() => signIn(provider.id, { callbackUrl })}
            type="button"
          >
            {provider.icon}
            {provider.label}
          </button>
        ))}
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z" fill="#EA4335" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path d="M12 4C6.9 4 2.75 7.17 2.75 11.08c0 2.5 1.7 4.7 4.26 5.96l-.73 2.68a.42.42 0 0 0 .64.46l3.18-2.1c.61.08 1.24.12 1.9.12 5.1 0 9.25-3.17 9.25-7.12S17.1 4 12 4Z" fill="currentColor" />
    </svg>
  );
}

function NaverIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path d="M14.7 12.45 9.02 4.5H4.5v15h4.8v-7.95l5.68 7.95h4.52v-15h-4.8v7.95Z" fill="currentColor" />
    </svg>
  );
}
