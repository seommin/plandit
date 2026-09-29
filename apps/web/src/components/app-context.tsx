"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/client-api";
import type { Page, Workspace } from "@/lib/types";

export type Theme = "system" | "light" | "dark";
export type SessionUser = { id: string; name: string; email: string };

type AppContextValue = {
  user: SessionUser;
  workspaces: Workspace[];
  workspace: Workspace | null;
  selectWorkspace: (id: string) => void;
  reloadWorkspaces: () => Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const AppContext = createContext<AppContextValue | null>(null);
const WORKSPACE_KEY = "plandit-workspace";
const THEME_KEY = "plandit-theme";

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

const readStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode: the choice just isn't remembered
  }
};

/** Signed-in user, the workspace list, the "current" workspace (credits, billing) and the color theme. */
export function AppProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>("system");

  const reloadWorkspaces = useCallback(async () => {
    const page = await api<Page<Workspace>>("/workspaces?limit=100");
    setWorkspaces(page.items);
    setWorkspaceId((current) => {
      const stored = current ?? readStorage(WORKSPACE_KEY);
      // Default: the first team workspace (that's where billing usually matters), else the personal one.
      return page.items.find((w) => w.id === stored)?.id ?? page.items.find((w) => w.type === "TEAM")?.id ?? page.items[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void reloadWorkspaces();
    const stored = readStorage(THEME_KEY);
    setThemeState(stored === "light" || stored === "dark" ? stored : "system");
  }, [reloadWorkspaces]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      workspaces,
      workspace: workspaces.find((w) => w.id === workspaceId) ?? null,
      selectWorkspace: (id) => {
        setWorkspaceId(id);
        writeStorage(WORKSPACE_KEY, id);
      },
      reloadWorkspaces,
      theme,
      setTheme: (next) => {
        setThemeState(next);
        writeStorage(THEME_KEY, next);
      },
    }),
    [user, workspaces, workspaceId, reloadWorkspaces, theme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
