import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4">
      <section className="panel w-full max-w-[420px] p-6">
        <div className="mb-7 text-center">
          <p className="mobile-brand-script text-[42px] leading-none">Plandit</p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <h1 className="text-base font-semibold">비밀번호 찾기</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            이메일 재설정 기능은 다음 단계에서 연결됩니다. 현재는 회원가입한
            이메일과 비밀번호로 로그인해주세요.
          </p>
        </div>
        <Link
          className="mt-5 flex h-11 items-center justify-center rounded-lg bg-[var(--ink)] text-sm font-semibold text-white"
          href="/login"
        >
          로그인으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
