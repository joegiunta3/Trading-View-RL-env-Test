import { ChevronLeft, ChevronRight, Crosshair, Magnet, Maximize2, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DrawingKind } from "../types";
import type { ChartControls } from "./ChartPanel";
import { IconButton } from "./ui";

export const LINE_TOOLS: { kind: DrawingKind; label: string; shortcut: string; key: string }[] = [
  { kind: "info_line", label: "Info line", shortcut: "Alt+I", key: "KeyI" },
  { kind: "trendline", label: "Trendline", shortcut: "Alt+T", key: "KeyT" },
  { kind: "horizontal_line", label: "Horizontal line", shortcut: "Alt+H", key: "KeyH" },
  { kind: "vertical_line", label: "Vertical line", shortcut: "Alt+V", key: "KeyV" },
];

/** Original line-tool icons (stroke = currentColor). */
export function ToolIcon({ kind, size = 18 }: { kind: DrawingKind; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      {kind === "trendline" && (
        <>
          <line x1="4" y1="14" x2="14" y2="4" {...common} />
          <circle cx="4" cy="14" r="1.8" {...common} />
          <circle cx="14" cy="4" r="1.8" {...common} />
        </>
      )}
      {kind === "info_line" && (
        <>
          <line x1="3" y1="12" x2="10" y2="5" {...common} />
          <circle cx="3" cy="12" r="1.6" {...common} />
          <circle cx="10" cy="5" r="1.6" {...common} />
          <rect x="10.5" y="10" width="6" height="5" rx="1.2" {...common} />
        </>
      )}
      {kind === "horizontal_line" && (
        <>
          <line x1="2" y1="9" x2="16" y2="9" {...common} />
          <circle cx="9" cy="9" r="1.8" {...common} />
        </>
      )}
      {kind === "vertical_line" && (
        <>
          <line x1="9" y1="2" x2="9" y2="16" {...common} />
          <circle cx="9" cy="9" r="1.8" {...common} />
        </>
      )}
    </svg>
  );
}

export function LeftRail({
  crosshair,
  onCrosshair,
  controls,
  tool,
  onTool,
  magnet,
  onMagnet,
  activeTicker,
  onRemoveDrawings,
}: {
  crosshair: boolean;
  onCrosshair: (v: boolean) => void;
  controls: React.RefObject<ChartControls | null>;
  tool: DrawingKind | null;
  onTool: (t: DrawingKind | null) => void;
  magnet: boolean;
  onMagnet: (v: boolean) => void;
  activeTicker: string;
  onRemoveDrawings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lastTool, setLastTool] = useState<DrawingKind>("info_line");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tool) setLastTool(tool);
  }, [tool]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2" aria-label="Chart tools">
      <IconButton
        label="Crosshair"
        active={crosshair && !tool}
        data-testid="tool-crosshair"
        onClick={() => {
          onTool(null);
          onCrosshair(!crosshair);
        }}
      >
        <Crosshair size={16} />
      </IconButton>
      <div ref={box} className="relative flex items-center">
        <IconButton
          label={`${LINE_TOOLS.find((t) => t.kind === lastTool)?.label} (click again to stop)`}
          active={tool != null}
          data-testid="tool-lines"
          onClick={() => onTool(tool ? null : lastTool)}
        >
          <ToolIcon kind={tool ?? lastTool} />
        </IconButton>
        <button
          type="button"
          aria-label="More line tools"
          aria-expanded={open}
          data-testid="tool-lines-menu"
          onClick={() => setOpen((o) => !o)}
          className="absolute -right-1.5 flex h-7 w-2.5 items-center justify-center rounded-r text-faint hover:bg-hover hover:text-text"
        >
          <ChevronRight size={10} />
        </button>
        {open && (
          <div
            role="menu"
            aria-label="Line tools"
            data-testid="lines-menu"
            className="absolute top-0 left-10 z-50 w-56 rounded border border-line-strong bg-raised py-1 shadow-2xl"
          >
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted uppercase">Lines</div>
            {LINE_TOOLS.map((t) => (
              <button
                key={t.kind}
                type="button"
                role="menuitemradio"
                aria-checked={tool === t.kind}
                data-testid={`tool-line-${t.kind}`}
                onClick={() => {
                  onTool(t.kind);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-[12px] hover:bg-hover ${
                  tool === t.kind ? "text-accent" : "text-text"
                }`}
              >
                <ToolIcon kind={t.kind} />
                <span className="flex-1">{t.label}</span>
                <span className="text-[11px] text-faint">{t.shortcut}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <IconButton
        label={magnet ? "Magnet on: points snap to bar open/high/low/close" : "Magnet off"}
        active={magnet}
        data-testid="tool-magnet"
        onClick={() => onMagnet(!magnet)}
      >
        <Magnet size={16} />
      </IconButton>
      <IconButton label={`Remove all drawings on ${activeTicker}`} data-testid="tool-remove-drawings" onClick={onRemoveDrawings}>
        <Trash2 size={15} />
      </IconButton>
      <div className="my-1 h-px w-5 bg-line" />
      <IconButton label="Zoom in" data-testid="tool-zoom-in" onClick={() => controls.current?.zoomIn()}>
        <ZoomIn size={16} />
      </IconButton>
      <IconButton label="Zoom out" data-testid="tool-zoom-out" onClick={() => controls.current?.zoomOut()}>
        <ZoomOut size={16} />
      </IconButton>
      <IconButton label="Scroll left" data-testid="tool-pan-left" onClick={() => controls.current?.panLeft()}>
        <ChevronLeft size={16} />
      </IconButton>
      <IconButton label="Scroll right" data-testid="tool-pan-right" onClick={() => controls.current?.panRight()}>
        <ChevronRight size={16} />
      </IconButton>
      <IconButton label="Reset view" data-testid="tool-reset-view" onClick={() => controls.current?.reset()}>
        <Maximize2 size={15} />
      </IconButton>
    </nav>
  );
}
