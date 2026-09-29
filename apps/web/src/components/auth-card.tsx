import type { ReactNode } from "react";

/** Full-screen, phone-first frame for sign-in and other pages outside the app shell. */
export function AuthCard({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="wordmark text-[32px] text-fg">PLANDIT</p>
          {subtitle ? <p className="mt-3 text-[15px] text-fg-2">{subtitle}</p> : null}
        </div>
        <div className="rounded-3xl bg-surface p-6 shadow-card">{children}</div>
      </div>
    </main>
  );
}

export const safeCallbackUrl = (value: string | null) => (value?.startsWith("/") && !value.startsWith("//") ? value : "/");
