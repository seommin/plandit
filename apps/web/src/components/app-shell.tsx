"use client";

import { CalendarDays, Coins, ListTodo, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useApp } from "./app-context";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "캘린더", icon: CalendarDays },
  { href: "/agenda", label: "일정", icon: ListTodo },
  { href: "/credits", label: "크레딧", icon: Coins },
  { href: "/settings", label: "설정", icon: Settings },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/**
 * Phones: content + fixed bottom tab bar with a centre "new event" button.
 * lg and up: left sidebar with the same destinations; the content gets the rest of the width.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useApp();
  const activeColumn = [0, 1, 3, 4][NAV.findIndex((item) => isActive(pathname, item.href))];

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <Link className="brand-script mb-8 text-center text-[34px] leading-none text-fg" href="/">
          Plandit
        </Link>
        <Link
          className="mb-6 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-on-primary transition-colors hover:bg-primary-strong"
          href="/?new=1"
        >
          <Plus size={18} />새 일정
        </Link>
        <nav aria-label="주요 메뉴" className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors",
                isActive(pathname, href) ? "bg-primary-weak text-primary" : "text-fg-2 hover:bg-surface-2",
              )}
              href={href}
              key={href}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <Link className="mt-auto flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-surface-2" href="/settings" title="내 계정 설정">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[14px] font-semibold">
            {user.name.slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className="block truncate text-xs text-fg-3">{user.email}</span>
          </span>
        </Link>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+20px)] lg:pb-0">{children}</main>

      {/* Floats 12px off the sides and bottom; content shows faintly through it */}
      <nav aria-label="주요 메뉴" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] lg:hidden">
        <div className="pointer-events-auto relative mx-auto grid h-[var(--tabbar-h)] max-w-md grid-cols-5 items-center rounded-full bg-surface/70 px-1 shadow-float backdrop-blur-md">
          {/* The selected tab's pill slides to the next tab instead of jumping (column 2 is the "+" button) */}
          <span
            aria-hidden="true"
            className={cn("absolute inset-y-0 left-1 flex w-[calc((100%-8px)/5)] items-center transition-transform duration-300 ease-out", activeColumn === undefined && "hidden")}
            style={{ transform: `translateX(${(activeColumn ?? 0) * 100}%)` }}
          >
            <span className="mx-1 h-12 flex-1 rounded-full bg-fg/10" />
          </span>
          {NAV.slice(0, 2).map((item) => (
            <TabLink key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
          <Link
            aria-label="새 일정"
            className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-float transition-transform active:scale-95"
            href="/?new=1"
          >
            <Plus size={24} />
          </Link>
          {NAV.slice(2).map((item) => (
            <TabLink key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function TabLink({ href, label, icon: Icon, active }: (typeof NAV)[number] & { active: boolean }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        // :hover without the (hover: hover) gate Tailwind's hover: adds, so a mouse in a narrow window gets it too
        "relative mx-1 flex h-12 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition-colors duration-300 [&:hover]:bg-fg/5",
        active ? "text-fg" : "text-fg-3",
      )}
      href={href}
    >
      <Icon size={22} />
      {label}
    </Link>
  );
}
