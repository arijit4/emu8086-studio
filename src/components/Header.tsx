import { useState } from "react";
import {
  Play, Pause, StepForward, StepBack, RotateCcw, Hammer, FolderOpen, ChevronDown,
  Gauge, Check,
} from "lucide-react";
import type { Snapshot } from "../emulator/machine";
import type { Example } from "../examples";
import { cn, fmtSpeed } from "../utils";

function Logo() {
  return (
    <div className="relative grid h-9 w-9 place-items-center rounded-lg border border-emerald-400/30 bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 shadow-[0_0_18px_rgba(16,185,129,0.25)]">
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
        <rect x="9.4" y="9.4" width="5.2" height="5.2" rx="0.6" />
        <path d="M9 2.8v3.2M15 2.8v3.2M9 18v3.2M15 18v3.2M2.8 9H6M2.8 15H6M18 9h3.2M18 15h3.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

interface BtnProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "run" | "warn";
  title?: string;
  pulse?: boolean;
}

function Btn({ icon, label, onClick, disabled, variant = "ghost", title, pulse }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "group/btn relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold tracking-wide transition-all duration-150 active:scale-[0.96]",
        variant === "run" &&
          "border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:shadow-[0_0_16px_rgba(16,185,129,0.25)]",
        variant === "warn" &&
          "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
        variant === "ghost" &&
          "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-100",
        disabled && "cursor-not-allowed opacity-35 hover:bg-white/[0.03] hover:shadow-none"
      )}
    >
      <span className={cn(pulse && !disabled && "dot-pulse")}>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  idle: { dot: "bg-zinc-400", text: "text-zinc-400 border-white/10 bg-white/[0.04]", label: "READY" },
  running: { dot: "bg-emerald-400 dot-pulse", text: "text-emerald-300 border-emerald-400/30 bg-emerald-500/10", label: "RUNNING" },
  paused: { dot: "bg-amber-400", text: "text-amber-300 border-amber-400/30 bg-amber-500/10", label: "PAUSED" },
  waiting: { dot: "bg-sky-400 dot-pulse", text: "text-sky-300 border-sky-400/30 bg-sky-500/10", label: "INPUT" },
  halted: { dot: "bg-zinc-500", text: "text-zinc-400 border-white/10 bg-white/[0.04]", label: "HALTED" },
  error: { dot: "bg-red-400 dot-pulse", text: "text-red-300 border-red-400/30 bg-red-500/10", label: "ERROR" },
};

interface Props {
  snap: Snapshot;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onAssemble: () => void;
  speeds: number[];
  speedIdx: number;
  onSpeedIdx: (i: number) => void;
  examples: Example[];
  activeExample: string;
  onPickExample: (e: Example) => void;
}

export default function Header(p: Props) {
  const [open, setOpen] = useState(false);
  const st = STATUS_STYLE[p.snap.status];
  const running = p.snap.status === "running";
  const waiting = p.snap.status === "waiting";

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-black/40 px-3 backdrop-blur-md sm:px-4">
      <div className="flex shrink-0 items-center gap-3">
        <Logo />
        <div className="leading-tight">
          <h1 className="font-display text-[15px] font-semibold tracking-tight text-zinc-100">
            emu<span className="text-emerald-400">8086</span>
          </h1>
          <p className="text-[9px] font-medium uppercase tracking-[0.3em] text-zinc-500">studio</p>
        </div>
      </div>

      <div className="mx-1 h-6 w-px shrink-0 bg-white/[0.07] sm:mx-2" />

      {/* execution controls — scrolls horizontally instead of breaking on narrow windows */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {running ? (
          <Btn icon={<Pause size={13} />} label="Pause" onClick={p.onPause} variant="warn" title="Pause execution" />
        ) : (
          <Btn
            icon={<Play size={13} />}
            label={p.snap.status === "paused" ? "Resume" : "Run"}
            onClick={p.onRun}
            variant="run"
            disabled={waiting}
            title="Run program (Ctrl+Enter)"
          />
        )}
        <Btn
          icon={<StepBack size={13} />}
          label="Back"
          onClick={p.onStepBack}
          disabled={running || waiting || !p.snap.canStepBack}
          title={
            p.snap.canStepBack
              ? `Undo the last instruction (${p.snap.historyDepth} available)`
              : "Nothing to step back to — reverse debugging records up to 25k op/s"
          }
        />
        <Btn icon={<StepForward size={13} />} label="Step" onClick={p.onStep} disabled={running || waiting} title="Execute one instruction (F10)" />
        <Btn icon={<RotateCcw size={13} />} label="Reset" onClick={p.onReset} title="Reload program and reset the CPU" />
        <div className="mx-0.5 h-6 w-px shrink-0 bg-white/[0.07]" />
        <Btn icon={<Hammer size={13} />} label="Assemble" onClick={p.onAssemble} title="Assemble source without running" />

        {/* status chip (rides inside the scroll region on narrow screens) */}
        <div className={cn("ml-1 hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-widest md:flex", st.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
          {st.label}
        </div>
      </div>

      {/* speed */}
      <div className="hidden shrink-0 items-center gap-2.5 lg:flex" title="Emulation speed">
        <Gauge size={13} className="text-zinc-500" />
        <input
          type="range"
          min={0}
          max={p.speeds.length - 1}
          step={1}
          value={p.speedIdx}
          onChange={(e) => p.onSpeedIdx(Number(e.target.value))}
          className="slider w-28"
        />
        <span className="w-16 font-mono text-[10px] tracking-wide text-zinc-400">{fmtSpeed(p.speeds[p.speedIdx])}</span>
      </div>

      <div className="mx-1 hidden h-6 w-px shrink-0 bg-white/[0.07] lg:block" />

      {/* examples */}
      <div className="relative shrink-0">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-100"
        >
          <FolderOpen size={13} className="text-zinc-500" />
          <span className="hidden max-w-40 truncate sm:inline">{p.activeExample}</span>
          <ChevronDown size={12} className={cn("text-zinc-500 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-label="close" />
            <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#0d1015]/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="border-b border-white/[0.06] px-3.5 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Example programs</p>
              </div>
              <div className="max-h-80 overflow-y-auto p-1.5">
                {p.examples.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => {
                      p.onPickExample(ex);
                      setOpen(false);
                    }}
                    className="group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-emerald-500/[0.08]"
                  >
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04] font-mono text-[9px] text-zinc-500 group-hover:border-emerald-400/30 group-hover:text-emerald-400">
                      {ex.id.replace("ex", "")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-200">
                        {ex.title}
                        {ex.title === p.activeExample && <Check size={11} className="text-emerald-400" />}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-zinc-500">{ex.tag}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
