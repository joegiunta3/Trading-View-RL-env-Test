import { theme } from "../theme";

/** Original mark: a framed rising step-line ending in a live dot. */
export function Logo({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 pr-2 select-none" data-testid="app-logo">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1" y="1" width="18" height="18" rx="5" fill="none" stroke={theme.accent} strokeWidth="1.6" />
        <path
          d="M5 13.5 L8 13.5 L8 10 L11 10 L11 7.5 L13.5 7.5"
          fill="none"
          stroke={theme.textStrong}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="14.6" cy="7.5" r="1.5" fill={theme.up} />
      </svg>
      <span className="text-[14px] font-semibold tracking-tight text-strong">{name}</span>
    </div>
  );
}
