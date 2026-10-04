import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "subtle" | "danger" | "up" | "down";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-strong hover:brightness-110",
  ghost: "text-muted hover:text-text hover:bg-hover",
  subtle: "bg-raised text-text border border-line hover:border-line-strong",
  danger: "bg-down-soft text-down hover:bg-down hover:text-strong",
  up: "bg-up text-strong hover:brightness-110",
  down: "bg-down text-strong hover:brightness-110",
};

export function Button({
  variant = "subtle",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function IconButton({
  label,
  active = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...props}
      className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-7 w-full rounded border border-line bg-bg px-2 text-[12px] outline-none placeholder:text-faint focus:border-accent ${className}`}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-7 w-full rounded border border-line bg-bg px-1.5 text-[12px] outline-none focus:border-accent ${className}`}
    />
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
}) {
  return (
    <div role="tablist" className="flex h-9 shrink-0 items-stretch gap-1 border-b border-line px-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          data-testid={`${idPrefix}-tab-${t.id}`}
          onClick={() => onChange(t.id)}
          className={`relative px-2.5 text-[12px] font-medium transition-colors ${
            value === t.id ? "text-strong" : "text-muted hover:text-text"
          }`}
        >
          {t.label}
          {value === t.id && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[12px] text-faint">{children}</div>;
}

export function ErrorText({ children, testId }: { children: ReactNode; testId?: string }) {
  if (!children) return null;
  return (
    <p role="alert" data-testid={testId} className="text-[11px] leading-snug text-down">
      {children}
    </p>
  );
}

export const th = "sticky top-0 z-10 bg-panel px-2 py-1.5 text-left text-[10px] font-semibold tracking-wider text-muted uppercase";
export const td = "px-2 py-1 whitespace-nowrap";
