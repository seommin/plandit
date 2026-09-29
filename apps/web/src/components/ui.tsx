"use client";

import { Check, ChevronDown, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  block?: boolean;
  loading?: boolean;
};

const buttonVariants = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "bg-transparent text-fg-2 hover:bg-surface-2",
  danger: "bg-danger-weak text-danger hover:brightness-95",
};

export function Button({ variant = "primary", size = "md", block, loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-12 px-4 text-[15px]" : "h-9 px-3 text-sm",
        buttonVariants[variant],
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      type="button"
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** 44×44 touch target; `label` is required because the button only shows an icon. */
export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg", className)}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-2xl bg-surface p-4 shadow-card", className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-9 items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold text-fg-3">{children}</h2>
      {action}
    </div>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "success" | "info"; children: ReactNode }) {
  const tones = { danger: "bg-danger-weak text-danger", success: "bg-surface-2 text-fg", info: "bg-surface-2 text-fg-2" };
  return (
    <p className={cn("rounded-xl px-3 py-2.5 text-sm font-medium", tones[tone])} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-3">{icon}</div> : null}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {description ? <p className="text-sm text-fg-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-primary";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-fg-2">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-fg-3">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, "h-12", className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, "min-h-24 py-3", className)} {...props} />;
}

/**
 * Our own dropdown (the browser's select popup can't be styled): the trigger shows the current choice and the list opens next to it.
 * The list is drawn on top of the page (portal), so rounded cards and sheets never clip it; it opens upward near the bottom edge
 * and closes on scroll. `variant="field"` looks like a text field inside forms, `variant="text"` is a quiet "value ▾" for inline use.
 * With `name` it submits with its form.
 */
export function Picker<T extends string | number>({
  value,
  defaultValue,
  options,
  onChange,
  label,
  name,
  variant = "field",
  align = "left",
  className,
}: {
  value?: T;
  defaultValue?: T;
  options: Array<{ value: T; label: string }>;
  onChange?: (value: T) => void;
  label: string;
  name?: string;
  variant?: "field" | "text";
  align?: "left" | "right";
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const open = anchor !== null;
  const current = value ?? inner;
  const selected = options.find((option) => option.value === current);

  useEffect(() => {
    if (!open) return;
    const close = () => setAnchor(null);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    const scrolled = (event: Event) => !listRef.current?.contains(event.target as Node) && close();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const LIST_MAX = 256;
  const upward = anchor ? anchor.bottom + LIST_MAX + 8 > window.innerHeight && anchor.top > window.innerHeight - anchor.bottom : false;

  return (
    <div
      className={cn("relative", className)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation(); // close the list, not the sheet around it
        setAnchor(null);
        triggerRef.current?.focus();
      }}
    >
      {name ? <input name={name} type="hidden" value={String(current ?? "")} /> : null}
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selected?.label ?? ""}`}
        className={cn(
          "flex items-center gap-1 text-left",
          variant === "field" ? cn(fieldClass, "h-12 justify-between", open && "border-primary") : "h-9 max-w-full rounded-lg px-2 text-[14px] font-semibold transition-colors hover:bg-surface-2",
        )}
        onClick={() => setAnchor(open ? null : (triggerRef.current?.getBoundingClientRect() ?? null))}
        ref={triggerRef}
        type="button"
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>
      {anchor
        ? createPortal(
            <ul
              className="animate-scrim fixed z-[70] overflow-y-auto rounded-xl bg-surface p-1 shadow-float ring-1 ring-line"
              ref={listRef}
              role="listbox"
              style={{
                maxHeight: LIST_MAX,
                minWidth: anchor.width,
                ...(upward ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
                ...(align === "right" ? { right: window.innerWidth - anchor.right } : { left: anchor.left }),
              }}
            >
              {options.map((option) => (
                <li key={String(option.value)}>
                  <button
                    aria-selected={option.value === current}
                    className={cn(
                      "flex h-10 w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 text-left text-[14px]",
                      option.value === current ? "font-semibold text-fg" : "text-fg-2 hover:bg-surface-2",
                    )}
                    onClick={() => {
                      setInner(option.value);
                      onChange?.(option.value);
                      setAnchor(null);
                    }}
                    role="option"
                    type="button"
                  >
                    <span className="flex-1">{option.label}</span>
                    {option.value === current ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Underlined text tabs for sections of content (다가오는 / 중요 …). View modes like 일/주/월 use Segmented. */
export function Tabs<T extends string>({ value, options, onChange, label, className }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div aria-label={label} className={cn("flex gap-5 overflow-x-auto scrollbar-hide", className)} role="tablist">
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className={cn("relative h-10 shrink-0 text-[15px] font-semibold transition-colors", option.value === value ? "text-fg" : "text-fg-3 hover:text-fg-2")}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
          {option.value === value ? <span aria-hidden="true" className="absolute inset-x-0 bottom-1.5 h-0.5 rounded-full bg-fg" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Segmented control, e.g. 월/주/목록. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-1" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className={cn(
            "h-8 rounded-lg px-3 text-[13px] font-semibold transition-colors",
            option.value === value ? "bg-surface text-fg shadow-card" : "text-fg-3 hover:text-fg-2",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Bottom sheet on phones, centered dialog from md up. Esc and the scrim close it; body scroll is locked while open.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  headerAction,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus(); // keep an autoFocus field
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div aria-hidden="true" className="animate-scrim absolute inset-0 bg-[var(--scrim)]" onClick={onClose} />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-float outline-none md:max-w-lg md:rounded-3xl"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-surface-3 md:hidden" />
        <div className="flex items-center gap-2 px-5 pb-2 pt-3 md:pt-5">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold" id={titleId}>
            {title}
          </h2>
          {headerAction}
          <IconButton className="-mr-2" label="닫기" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="border-t border-line px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
