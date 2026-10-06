/**
 * Design tokens. Every color in the app comes from here; nothing else hardcodes a hex value.
 * Tokens are exposed to CSS/Tailwind as --cv-* custom properties by applyTheme().
 */
export const theme = {
  bg: "#11151d",
  panel: "#181d27",
  panelRaised: "#1e2431",
  hover: "#232a38",
  border: "#262c38",
  borderStrong: "#343c4c",
  grid: "#1f2430",
  text: "#d3d7df",
  textStrong: "#f1f3f7",
  muted: "#7d8596",
  faint: "#535b6b",
  up: "#2bb673",
  down: "#e5484d",
  accent: "#3d7eff",
  accentSoft: "#3d7eff26",
  warn: "#e8a33d",
  upSoft: "#2bb67326",
  downSoft: "#e5484d26",
  volUp: "#2bb6735c",
  volDown: "#e5484d5c",
  crosshair: "#8a93a6",
  overlay: "#0b0e14cc",
} as const;

/** Line colors for price overlays (SMA, EMA, BB, VWAP), assigned in order. */
export const smaColors = ["#f2b84b", "#a68bff", "#3cc6c0", "#ff8f66", "#7fb2ff"] as const;

/** Strategy markers: long entries blue, short entries red, exits magenta. */
export const strategyColors = {
  long: "#4c8dff",
  short: "#f0525a",
  exit: "#d16aff",
  label: "#c3c9d4",
} as const;

/** Lower-pane indicator colors. */
export const indicatorColors = {
  rsi: "#b48cff",
  rsiBand: "#3a4152",
  macd: "#4c8dff",
  signal: "#ff9f43",
  k: "#f2b84b",
  d: "#4c8dff",
  j: "#d16aff",
} as const;

export type ThemeToken = keyof typeof theme;

export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(theme)) {
    root.style.setProperty(`--cv-${key}`, value);
  }
}
