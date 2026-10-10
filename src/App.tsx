import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { FileCode2, AlertTriangle, CheckCircle2, CircleDot } from "lucide-react";
import { Machine, type Snapshot } from "./emulator/machine";
import { EXAMPLES, type Example } from "./examples";
import Header from "./components/Header";
import CodeEditor, { jumpToLine } from "./components/CodeEditor";
import { formatAssembly } from "./editor/asm8086";
import CpuPanel from "./components/CpuPanel";
import MemoryPanel from "./components/MemoryPanel";
import ConsolePanel from "./components/ConsolePanel";
import Splitter from "./components/Splitter";
import UpdateNotice from "./components/UpdateNotice";
import { cn, hex, fmtCount } from "./utils";
import { useUpdateCheck } from "./update";

const SPEEDS = [1, 2, 3, 10, 100, 1000, 15000, 2000000];

/* default split ratios (percent of the container) */
const DEFAULTS = { col: 58, editor: 64, cpu: 46 };
const MIN_PCT = 18;
const MAX_PCT = 82;
const LS_KEY = "emu8086.layout";
const THEME_KEY = "emu8086.theme";
const FONT_SIZE_KEY = "emu8086.editor-font-size";
type Theme = "dark" | "light" | "system";

const clampPct = (v: number) => Math.min(MAX_PCT, Math.max(MIN_PCT, v));

export default function App() {
  const machineRef = useRef<Machine | null>(null);
  if (!machineRef.current) machineRef.current = new Machine();
  const machine = machineRef.current;

  const [snap, setSnap] = useState<Snapshot>(() => machine.snapshot());
  const [code, setCode] = useState(EXAMPLES[0].code);
  const [activeExample, setActiveExample] = useState(EXAMPLES[0].title);
  const [isExampleOpen, setIsExampleOpen] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(3);
  const [vimOn, setVimOn] = useState(false);
  const [completionOn, setCompletionOn] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "system" ? stored : "dark";
  });
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  const [editorFontSize, setEditorFontSize] = useState(() => {
    const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
    return Number.isFinite(stored) ? Math.min(24, Math.max(9, stored)) : 11;
  });
  const [memoryMinimized, setMemoryMinimized] = useState(false);
  const [cpuMinimized, setCpuMinimized] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const { release, showNotice, checking, verdict, checkForUpdate, dismissRelease } = useUpdateCheck();

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = theme === "system" ? (mediaQuery.matches ? "dark" : "light") : theme;
      setResolvedTheme(resolvedTheme);
      document.documentElement.dataset.theme = resolvedTheme;
    };

    applyTheme();
    if (theme === "system") {
      mediaQuery.addEventListener("change", applyTheme);
    }
    localStorage.setItem(THEME_KEY, theme);

    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(FONT_SIZE_KEY, String(editorFontSize));
  }, [editorFontSize]);

  /* ---------- resizable layout ---------- */
  const [split, setSplit] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          col: clampPct(p.col ?? DEFAULTS.col),
          editor: clampPct(p.editor ?? DEFAULTS.editor),
          cpu: clampPct(p.cpu ?? DEFAULTS.cpu),
        };
      }
    } catch {
      /* ignore malformed storage */
    }
    return { ...DEFAULTS };
  });

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(split));
    } catch {
      /* storage may be unavailable */
    }
  }, [split]);

  const mainRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const dragBase = useRef(0);

  const beginDrag = (which: "col" | "editor" | "cpu") => () => {
    dragBase.current = split[which];
  };

  const makeDrag = useCallback(
    (which: "col" | "editor" | "cpu", ref: React.RefObject<HTMLDivElement | null>, axis: "x" | "y") =>
      (delta: number) => {
        const el = ref.current;
        if (!el) return;
        const size = axis === "x" ? el.clientWidth : el.clientHeight;
        if (!size) return;
        const next = clampPct(dragBase.current + (delta / size) * 100);
        setSplit((s) => (s[which] === next ? s : { ...s, [which]: next }));
      },
    []
  );

  const resetSplit = (which: "col" | "editor" | "cpu") => () =>
    setSplit((s) => ({ ...s, [which]: DEFAULTS[which] }));

  /* ---------- machine wiring ---------- */
  useEffect(() => machine.subscribe(() => setSnap(machine.snapshot())), [machine]);

  useEffect(() => {
    machine.speed = SPEEDS[speedIdx];
  }, [machine, speedIdx]);

  useEffect(() => {
    machine.setSource(EXAMPLES[0].code);
    machine.assemble();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (v: string) => {
    setCode(v);
    machine.setSource(v);
  };

  const pickExample = (ex: Example) => {
    setCode(ex.code);
    setActiveExample(ex.title);
    setIsExampleOpen(true);
    machine.setSource(ex.code);
    machine.assemble();
  };

  const openCode = (nextCode: string, fileName: string) => {
    setCode(nextCode);
    setActiveExample(fileName.replace(/\.(?:asm|txt)$/i, "") || "Untitled");
    setIsExampleOpen(false);
    machine.setSource(nextCode);
    machine.assemble();
  };

  const newFile = () => {
    setCode("");
    setActiveExample("Untitled");
    setIsExampleOpen(false);
    machine.setSource("");
    machine.assemble();
  };

  const onRun = () => machine.run();
  const execLine =
    snap.status === "running" || snap.status === "paused" || snap.status === "waiting" || snap.status === "halted"
      ? snap.execLine
      : null;

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-[#07090c] text-zinc-300"
      onContextMenu={(event) => event.preventDefault()}
    >
      <UpdateNotice release={showNotice ? release : null} onDismiss={dismissRelease} />
      {/* background decor */}
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="glow-emerald pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2" />
      <div className="glow-sky pointer-events-none absolute -bottom-52 -right-40 h-[420px] w-[560px]" />

      <Header
        snap={snap}
        onRun={onRun}
        onPause={() => machine.pause()}
        onStep={() => machine.step()}
        onStepBack={() => machine.stepBack()}
        onReset={() => machine.reset()}
        onAssemble={() => machine.assemble()}
        speeds={SPEEDS}
        speedIdx={speedIdx}
        onSpeedIdx={setSpeedIdx}
        examples={EXAMPLES}
        activeExample={activeExample}
        onPickExample={pickExample}
        code={code}
        onOpenCode={openCode}
        onNewFile={newFile}
        isExampleOpen={isExampleOpen}
        theme={theme}
        onTheme={setTheme}
        editorFontSize={editorFontSize}
        onEditorFontSize={setEditorFontSize}
        updateAvailable={release !== null}
        checkingForUpdate={checking}
        updateVerdict={verdict}
        onCheckForUpdate={() => void checkForUpdate(true)}
      />

      {/*
        < lg : single scrolling page, panels stacked (editor → console → cpu → memory).
        >= lg: two resizable columns; every panel boundary is a draggable splitter.
      */}
      <main
        ref={mainRef}
        className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-contain p-3 lg:flex lg:gap-0 lg:overflow-hidden"
      >
        {/* ---------------- left column: editor + memory ---------------- */}
        <div
          ref={leftRef}
          className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col"
          style={{ width: `${split.col}%`, flex: "0 0 auto" }}
        >
          {/* editor */}
          <section
            className="panel order-1 flex min-h-[380px] flex-col overflow-hidden lg:order-none lg:min-h-0"
            style={{
              flex: memoryMinimized ? "1 1 0" : `0 0 ${split.editor}%`,
            }}
          >
            <div className="hairline-glow" />
            <header className="flex items-center justify-between gap-2 border-b border-white/[0.05] px-3.5 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileCode2 size={12} className="shrink-0 text-zinc-500" />
                <span className="font-mono text-[11px] font-medium text-zinc-300">main.asm</span>
                {snap.dirty ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-amber-300">
                    <CircleDot size={8} />
                    EDITED
                  </span>
                ) : snap.errors.length === 0 ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-emerald-300">
                    <CheckCircle2 size={8} />
                    ASSEMBLED
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-red-300">
                    <AlertTriangle size={8} />
                    {snap.errors.length} ERROR{snap.errors.length === 1 ? "" : "S"}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden font-mono text-[9px] tracking-wider text-zinc-600 sm:block">
                  {snap.codeBytes}B code · {snap.dataBytes}B data
                </span>
                <button
                  onClick={() => setVimOn((v) => !v)}
                  title="Toggle Vim keybindings"
                  className={cn(
                    "flex h-6 items-center rounded-md border px-1.5 font-mono text-[9px] font-bold tracking-wider transition-colors",
                    vimOn
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  VIM
                </button>
                <button
                  onClick={() => setCompletionOn((v) => !v)}
                  title="Toggle code completion"
                  className={cn(
                    "flex h-6 items-center rounded-md border px-1.5 font-mono text-[9px] font-bold tracking-wider transition-colors",
                    completionOn
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  COMPLETION
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1">
              <CodeEditor
                value={code}
                onChange={onChange}
                execLine={execLine}
                running={snap.status === "running"}
                vimEnabled={vimOn}
                completionEnabled={completionOn}
                onRunShortcut={onRun}
                onStepShortcut={() => machine.step()}
                onFormatShortcut={formatAssembly}
                onViewReady={(v) => (viewRef.current = v)}
                fontSize={editorFontSize}
                theme={resolvedTheme}
              />
            </div>

            {/* assembly errors */}
            {snap.errors.length > 0 && (
              <div className="max-h-24 overflow-y-auto border-t border-red-400/15 bg-red-500/[0.04] px-3.5 py-2">
                {snap.errors.slice(0, 4).map((e, i) => (
                  <button
                    key={i}
                    onClick={() => jumpToLine(viewRef.current, e.line)}
                    className="flex w-full items-center gap-2 rounded px-1 py-[3px] text-left font-mono text-[11px] text-red-300/90 transition-colors hover:bg-red-500/10"
                  >
                    <AlertTriangle size={10} className="shrink-0 text-red-400/70" />
                    <span className="shrink-0 text-red-400/70">line {e.line}</span>
                    <span className="truncate">{e.message}</span>
                  </button>
                ))}
                {snap.errors.length > 4 && (
                  <p className="px-1 pt-1 font-mono text-[10px] text-red-300/50">+ {snap.errors.length - 4} more…</p>
                )}
              </div>
            )}
          </section>

          {/* editor / memory splitter */}
          <div className={cn("order-1 hidden lg:order-none lg:block", memoryMinimized && "lg:hidden")}>
            <Splitter
              dir="v"
              onStart={beginDrag("editor")}
              onDrag={makeDrag("editor", leftRef, "y")}
              onReset={resetSplit("editor")}
            />
          </div>

          {/* memory */}
          <div
            className={cn(
              "order-4 shrink-0 lg:order-none lg:min-h-0",
              memoryMinimized && "lg:mt-3",
              memoryMinimized ? "h-auto lg:flex-none" : "h-[252px] lg:flex-1"
            )}
          >
            <MemoryPanel
              machine={machine}
              snap={snap}
              minimized={memoryMinimized}
              onToggleMinimize={() => setMemoryMinimized((v) => !v)}
            />
          </div>
        </div>

        {/* column splitter */}
        <div className="hidden lg:block">
          <Splitter
            dir="h"
            onStart={beginDrag("col")}
            onDrag={makeDrag("col", mainRef, "x")}
            onReset={resetSplit("col")}
          />
        </div>

        {/* ---------------- right column: cpu + console ---------------- */}
        <div ref={rightRef} className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col">
          <div
            className={cn(
              "order-3 shrink-0 lg:order-none lg:min-h-0 lg:overflow-y-auto",
              cpuMinimized && "lg:flex-none"
            )}
            style={cpuMinimized ? undefined : { flex: `0 0 ${split.cpu}%` }}
          >
            <CpuPanel
              snap={snap}
              minimized={cpuMinimized}
              onToggleMinimize={() => setCpuMinimized((v) => !v)}
            />
          </div>

          {/* cpu / console splitter */}
          <div className={cn("order-3 hidden lg:order-none lg:block", cpuMinimized && "lg:hidden")}>
            <Splitter
              dir="v"
              onStart={beginDrag("cpu")}
              onDrag={makeDrag("cpu", rightRef, "y")}
              onReset={resetSplit("cpu")}
            />
          </div>

          <div
            className={cn(
              "order-2 flex h-[340px] min-h-0 flex-col lg:order-none lg:h-auto lg:flex-1",
              cpuMinimized && "lg:mt-3"
            )}
          >
            <ConsolePanel machine={machine} snap={snap} />
          </div>
        </div>
      </main>

      {/* ---------------- status bar ---------------- */}
      <footer className="relative z-10 flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t border-white/[0.06] bg-black/40 px-3.5 font-mono text-[10px] text-zinc-500 backdrop-blur-md">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              snap.status === "running" && "bg-emerald-400 dot-pulse",
              snap.status === "waiting" && "bg-sky-400 dot-pulse",
              snap.status === "paused" && "bg-amber-400",
              snap.status === "error" && "bg-red-400",
              (snap.status === "idle" || snap.status === "halted") && "bg-zinc-500"
            )}
          />
          <span className="truncate">{snap.message}</span>
        </span>
        <span className="ml-auto hidden shrink-0 items-center gap-4 md:flex">
          <span>
            CS:IP{" "}
            <span className="text-zinc-300">
              {hex(snap.segs[1])}:{hex(snap.ipAddr)}
            </span>
          </span>
          <span className="max-w-56 truncate">
            <span className="text-zinc-600">next&nbsp;</span>
            <span className="text-sky-300/80">{snap.current}</span>
          </span>
          <span title="Reversible steps held in the undo journal">
            <span className="text-zinc-600">undo </span>
            <span className={snap.canStepBack ? "text-amber-300/80" : "text-zinc-600"}>{snap.historyDepth}</span>
          </span>
          <span>
            <span className="text-emerald-400/80">{fmtCount(snap.cycles)}</span> instr
          </span>
        </span>
        <span className="hidden shrink-0 text-zinc-600 xl:block">Ctrl+Enter run · F10 step · Ctrl+Alt+L format</span>
      </footer>
    </div>
  );
}
