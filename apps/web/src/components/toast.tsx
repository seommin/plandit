"use client";

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

type Toast = { id: number; message: string; action?: { label: string; onClick: () => void } };
type ToastApi = { show: (message: string, action?: Toast["action"]) => void };

const ToastContext = createContext<ToastApi>({ show: () => undefined });

/**
 * One toast at a time, bottom of the screen above the tab bar. Used instead of confirm dialogs:
 * do the action right away and offer "되돌리기" for a few seconds.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((message: string, action?: Toast["action"]) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, action });
    timer.current = setTimeout(() => setToast((current) => (current?.id === id ? null : current)), action ? 5_000 : 2_500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+24px)] z-[60] flex justify-center px-4 lg:bottom-6"
      >
        {toast ? (
          <div className="animate-toast pointer-events-auto flex min-h-12 max-w-md items-center gap-4 rounded-2xl bg-fg py-2 pl-4 pr-2 text-[14px] font-medium text-bg shadow-float" key={toast.id} role="status">
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.action ? (
              <button
                className="h-9 shrink-0 rounded-xl px-3 font-semibold text-bg underline-offset-4 hover:underline"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
                type="button"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
