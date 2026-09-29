"use client";

import { Check, ChevronDown, Users } from "lucide-react";
import { useState } from "react";

import { useApp } from "./app-context";
import { cn, Sheet } from "./ui";

export const ROLE_LABELS = { OWNER: "소유자", ADMIN: "관리자", MEMBER: "멤버" } as const;

/** Current workspace (billing context) as a tappable title; the sheet lists every workspace I belong to. */
export function WorkspaceSwitcher() {
  const { workspaces, workspace, selectWorkspace } = useApp();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="flex h-11 min-w-0 items-center gap-1.5 rounded-xl px-2 text-left hover:bg-surface-2"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="truncate text-[21px] font-bold tracking-tight lg:text-2xl">{workspace?.name ?? "워크스페이스"}</span>
        <ChevronDown className="shrink-0 text-fg-3" size={18} />
      </button>
      <Sheet onClose={() => setOpen(false)} open={open} title="워크스페이스">
        <ul className="space-y-1">
          {workspaces.map((w) => (
            <li key={w.id}>
              <button
                className={cn("flex h-14 w-full items-center gap-3 rounded-xl px-3 text-left", w.id === workspace?.id ? "bg-primary-weak" : "hover:bg-surface-2")}
                onClick={() => {
                  selectWorkspace(w.id);
                  setOpen(false);
                }}
                type="button"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-fg-2">
                  <Users size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{w.name}</span>
                  <span className="block text-xs text-fg-3">
                    {w.type === "PERSONAL" ? "개인" : "팀"} · {ROLE_LABELS[w.role]}
                  </span>
                </span>
                {w.id === workspace?.id ? <Check className="text-primary" size={18} /> : null}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
