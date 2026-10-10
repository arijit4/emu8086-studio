import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Play, Pause, StepForward, StepBack, RotateCcw, Hammer, File, FolderOpen, Download, ChevronDown,
  Gauge, Check,
  Settings, Sun, Moon, Monitor, Minus, Plus, RefreshCw,
} from "lucide-react";
import type { Snapshot } from "../emulator/machine";
import type { Example } from "../examples";
import { cn, fmtSpeed } from "../utils";

type Theme = "dark" | "light" | "system";

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<Array<{
    name: string;
    getFile: () => Promise<File>;
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>>;
}

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

// @ts-ignore
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
      {/*<span className="hidden sm:inline">{label}</span>*/}
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
  code: string;
  onOpenCode: (code: string, fileName: string) => void;
  onNewFile: () => void;
  isExampleOpen: boolean;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  editorFontSize: number;
  onEditorFontSize: (size: number) => void;
  updateAvailable: boolean;
  checkingForUpdate: boolean;
  updateVerdict: string | null;
  onCheckForUpdate: () => void;
}

export default function Header(p: Props) {
  const [fileOpen, setFileOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const openedFileRef = useRef<{
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  } | null>(null);
  const st = STATUS_STYLE[p.snap.status];
  const running = p.snap.status === "running";
  const waiting = p.snap.status === "waiting";

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch((error) => console.warn("Unable to determine the app version.", error));
  }, []);

  useEffect(() => {
    if (!fileOpen && !settingsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (fileOpen && !fileRef.current?.contains(target)) {
        setFileOpen(false);
        setExamplesOpen(false);
      }
      if (settingsOpen && !settingsRef.current?.contains(target)) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [fileOpen, settingsOpen]);

  const saveAsCode = async () => {
    const baseName = p.activeExample.trim().replace(/\.[^/.]+$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "main";
    const picker = (window as SavePickerWindow).showSaveFilePicker;

    if (!picker) {
      window.alert("Saving to a chosen location is not supported by this browser. Please use a Chromium-based browser.");
      return;
    }

    try {
      const handle = await picker({
        suggestedName: `${baseName}.asm`,
        types: [{ description: "Assembly", accept: { "text/plain": [".asm"] } }],
      });
      openedFileRef.current = handle;
      const writable = await handle.createWritable();
      await writable.write(p.code);
      await writable.close();
      setFileOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Unable to save the assembly file.", error);
      window.alert("Unable to save the assembly file.");
    }
  };

  const saveCode = async () => {
    if (!openedFileRef.current) {
      await saveAsCode();
      return;
    }

    try {
      const writable = await openedFileRef.current.createWritable();
      await writable.write(p.code);
      await writable.close();
      setFileOpen(false);
    } catch (error) {
      console.error("Unable to save the opened assembly file.", error);
    }
  };

  const createNewFile = () => {
    openedFileRef.current = null;
    p.onNewFile();
    setFileOpen(false);
  };

  const openFile = async () => {
    const openPicker = (window as SavePickerWindow).showOpenFilePicker;
    if (!openPicker) {
      fileInputRef.current?.click();
      setFileOpen(false);
      return;
    }

    try {
      const [handle] = await openPicker({
        multiple: false,
        types: [{ description: "Assembly or text", accept: { "text/plain": [".asm", ".txt"] } }],
      });
      if (!handle) return;
      const file = await handle.getFile();
      openedFileRef.current = handle;
      p.onOpenCode(await file.text(), file.name);
      setFileOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Unable to open the assembly file.", error);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    openedFileRef.current = null;
    const text = await file.text();
    p.onOpenCode(text, file.name);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (event.shiftKey) {
        void saveAsCode();
      } else if (!p.isExampleOpen) {
        void saveCode();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-black/40 px-3 backdrop-blur-md sm:px-4">
      <div className="flex shrink-0 items-center gap-3">
        <Logo />
        <div className="leading-tight">
          <h1 className="font-display text-[15px] font-semibold tracking-tight text-zinc-100">
            asm<span className="text-emerald-400">8086</span>
          </h1>
          <p className="text-[9px] font-medium uppercase tracking-[0.3em] text-zinc-500">
            {appVersion ? `v${appVersion}` : "version"}
          </p>
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

      {/* file menu */}
      <div ref={fileRef} className="relative shrink-0">
        <button
          onClick={() => {
            setFileOpen((v) => !v);
            setExamplesOpen(false);
          }}
          aria-expanded={fileOpen}
          className="flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-100"
        >
          <File size={13} className="text-zinc-500" />
          <ChevronDown size={12} className={cn("text-zinc-500 transition-transform", fileOpen && "rotate-180")} />
        </button>
        {fileOpen && (
          <div className="absolute right-0 z-[100] mt-2 w-56 overflow-visible rounded-xl border border-white/10 bg-[#0d1015]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <button onClick={createNewFile} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100">
              <File size={14} className="ml-0.5 mr-0.5 text-zinc-500" />
              New file
            </button>
            <button onClick={openFile} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100">
              <FolderOpen size={14} className="ml-0.5 mr-0.5 text-zinc-500" />
              Open
            </button>
            <button
              onClick={() => void saveCode()}
              disabled={p.isExampleOpen}
              title={p.isExampleOpen ? "Save is unavailable while an example is open" : "Save (Ctrl+S)"}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <Download size={14} className="ml-0.5 mr-0.5 text-zinc-500" />
              <span className="flex-1">Save</span>
              <kbd className="font-mono text-[9px] text-zinc-600">Ctrl+S</kbd>
            </button>
            <button onClick={() => void saveAsCode()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100">
              <Download size={14} className="ml-0.5 mr-0.5 text-zinc-500" />
              <span className="flex-1">Save as</span>
              <kbd className="font-mono text-[9px] text-zinc-600">Ctrl+Shift+S</kbd>
            </button>
            <div className="relative">
              <button
                onClick={() => setExamplesOpen((v) => !v)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100"
              >
                <File size={14} className="ml-0.5 mr-0.5 text-zinc-500" />
                <span className="flex-1">Examples</span>
                <ChevronDown size={12} className={cn("text-zinc-500 transition-transform", examplesOpen && "rotate-180")} />
              </button>
              {examplesOpen && (
                <div className="absolute right-full top-0 mr-1 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#0d1015]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                  <div className="border-b border-white/[0.06] px-2.5 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Example programs</p>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {p.examples.map((ex) => (
                      <button
                        key={ex.id}
                        onClick={() => {
                          p.onPickExample(ex);
                          setFileOpen(false);
                          setExamplesOpen(false);
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
              )}
            </div>
          </div>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept=".asm,.txt,text/plain" className="hidden" onChange={handleFileChange} />

      <div ref={settingsRef} className="relative shrink-0">
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Open settings"
          aria-expanded={settingsOpen}
          title="Settings"
          className="relative grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-100"
        >
          <Settings size={14} className={cn(settingsOpen && "rotate-45 transition-transform")} />
          {p.updateAvailable && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.9)]" />}
        </button>
        {settingsOpen && (
          <div className="absolute right-0 z-[100] mt-2 w-72 rounded-xl border border-white/10 bg-[#0d1015]/95 p-3.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="mb-3 border-b border-white/[0.06] pb-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Settings</p>
              </div>
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-zinc-200">Theme</span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600">{p.theme}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    ["dark", Moon, "Dark"],
                    ["light", Sun, "Light"],
                    ["system", Monitor, "System"],
                  ] as const).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      onClick={() => p.onTheme(value)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[10px] transition-colors",
                        p.theme === value
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                          : "border-white/10 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
                      )}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-zinc-200">Editor font size</span>
                  <span className="font-mono text-[10px] text-zinc-500">{p.editorFontSize}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => p.onEditorFontSize(Math.max(9, p.editorFontSize - 1))}
                    aria-label="Decrease editor font size"
                    className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    type="range"
                    min={9}
                    max={24}
                    value={p.editorFontSize}
                    onChange={(e) => p.onEditorFontSize(Number(e.target.value))}
                    className="slider min-w-0 flex-1"
                    aria-label="Editor font size"
                  />
                  <button
                    onClick={() => p.onEditorFontSize(Math.min(24, p.editorFontSize + 1))}
                    aria-label="Increase editor font size"
                    className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
              <button
                onClick={p.onCheckForUpdate}
                disabled={p.checkingForUpdate}
                className="flex w-full items-center justify-between rounded-lg border border-white/10 px-2.5 py-2 text-left text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
              >
                <span>{p.checkingForUpdate ? "Checking for updates..." : "Check for updates"}</span>
                <RefreshCw size={13} className={cn(p.checkingForUpdate && "animate-spin")} />
              </button>
              {p.updateVerdict && (
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500" role="status">
                  {p.updateVerdict}
                </p>
              )}
          </div>
        )}
      </div>
    </header>
  );
}
