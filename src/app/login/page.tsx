import { CalendarDays } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4">
      <section className="panel w-full max-w-[420px] p-6">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--ink)] text-white">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Plandit</h1>
            <p className="text-sm text-[var(--muted)]">계정으로 계속하기</p>
          </div>
        </div>

        <form className="space-y-3">
          <input
            className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
            name="email"
            placeholder="you@example.com"
            type="email"
          />
          <input
            className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[#aeb3a6]"
            name="password"
            placeholder="password"
            type="password"
          />
          <button className="h-11 w-full rounded-lg bg-[var(--ink)] text-sm font-semibold text-white">
            로그인
          </button>
        </form>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {["Google", "Kakao", "Naver"].map((provider) => (
            <button
              key={provider}
              className="h-10 rounded-lg border border-[var(--line)] bg-white text-sm font-semibold"
            >
              {provider}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
