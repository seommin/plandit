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
  const { user, workspace } = useApp();

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <Link className="wordmark mb-8 px-2 text-[24px] text-fg" href="/">
          PLANDIT
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
        <div className="mt-auto rounded-2xl bg-surface-2 p-3">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-fg-3">{workspace ? workspace.name : user.email}</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+8px)] lg:pb-0">{children}</main>

      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid h-[var(--tabbar-h)] max-w-md grid-cols-5 items-center">
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
      className={cn("flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold", active ? "text-fg" : "text-fg-3")}
      href={href}
    >
      <Icon size={22} strokeWidth={active ? 2.4 : 2} />
      {label}
    </Link>
  );
}
