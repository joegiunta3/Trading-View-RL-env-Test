import { ChevronLeft, ChevronRight, Crosshair, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { ChartControls } from "./ChartPanel";
import { IconButton } from "./ui";

export function LeftRail({
  crosshair,
  onCrosshair,
  controls,
}: {
  crosshair: boolean;
  onCrosshair: (v: boolean) => void;
  controls: React.MutableRefObject<ChartControls | null>;
}) {
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2" aria-label="Chart tools">
      <IconButton label="Crosshair" active={crosshair} data-testid="tool-crosshair" onClick={() => onCrosshair(!crosshair)}>
        <Crosshair size={16} />
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
