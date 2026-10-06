import { useCallback, useEffect, useRef } from "react";
import { cn } from "../utils";

interface Props {
  /** "v" = a horizontal bar that resizes panels stacked vertically.
   *  "h" = a vertical bar that resizes columns side by side. */
  dir: "v" | "h";
  /** receives the drag delta in pixels since the gesture started */
  onDrag: (deltaPx: number) => void;
  onStart: () => void;
  onReset?: () => void;
  className?: string;
}

export default function Splitter({ dir, onDrag, onStart, onReset, className }: Props) {
  const dragging = useRef(false);
  const origin = useRef(0);

  const move = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const pos = dir === "v" ? e.clientY : e.clientX;
      onDrag(pos - origin.current);
    },
    [dir, onDrag]
  );

  const up = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [move, up]);

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    origin.current = dir === "v" ? e.clientY : e.clientX;
    onStart();
    document.body.style.cursor = dir === "v" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  };

  /* keyboard accessibility: arrows nudge by 24px */
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 24;
    const neg = dir === "v" ? "ArrowUp" : "ArrowLeft";
    const pos = dir === "v" ? "ArrowDown" : "ArrowRight";
    if (e.key === neg || e.key === pos) {
      e.preventDefault();
      onStart();
      onDrag(e.key === neg ? -step : step);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={dir === "v" ? "horizontal" : "vertical"}
      tabIndex={0}
      onPointerDown={down}
      onDoubleClick={onReset}
      onKeyDown={key}
      title="Drag to resize · double-click to reset"
      className={cn(
        "group relative z-20 shrink-0 touch-none outline-none",
        dir === "v" ? "h-3 w-full cursor-row-resize" : "h-full w-3 cursor-col-resize",
        className
      )}
    >
      {/* hit area is 12px; the visible line is thin and lights up on hover */}
      <span
        className={cn(
          "absolute rounded-full bg-white/[0.07] transition-all duration-150",
          "group-hover:bg-emerald-400/50 group-focus-visible:bg-emerald-400/60",
          dir === "v"
            ? "left-1/2 top-1/2 h-[3px] w-10 -translate-x-1/2 -translate-y-1/2 group-hover:w-20"
            : "left-1/2 top-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 group-hover:h-20"
        )}
      />
    </div>
  );
}
