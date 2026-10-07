import { useEffect, useRef } from "react";
import { Terminal, Eraser, MousePointerClick } from "lucide-react";
import type { Machine, Snapshot } from "../emulator/machine";
import { cn } from "../utils";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function ConsolePanel({ machine, snap }: { machine: Machine; snap: Snapshot }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLDivElement | null>(null);
  const lastRev = useRef(-1);
  const lastStatus = useRef("");

  /* imperative CRT painter — survives fast output bursts */
  useEffect(() => {
    const paint = () => {
      const pre = preRef.current;
      const wrap = wrapRef.current;
      if (!pre || !wrap) return;
      const s = machine.screen;
      if (s.rev === lastRev.current && machine.status === lastStatus.current) return;
      lastRev.current = s.rev;
      lastStatus.current = machine.status;
      const showCursor = machine.status === "waiting";
      let html = "";
      for (let i = 0; i < s.rows.length; i++) {
        const line = s.rows[i];
        const cls = s.sys[i] ? "crt-line sys" : "crt-line";
        if (showCursor && i === s.row) {
          const before = esc(line.slice(0, s.col));
          const cur = line[s.col] ? esc(line[s.col]) : "&nbsp;";
          const after = esc(line.slice(s.col + 1));
          html += `<div class="${cls}">${before}<span class="crt-cursor">${cur}</span>${after}</div>`;
        } else {
          html += `<div class="${cls}">${line ? esc(line) : "&nbsp;"}</div>`;
        }
      }
      pre.innerHTML = html;
      wrap.scrollTop = wrap.scrollHeight;
    };
    paint();
    const unsub = machine.subscribe(paint);
    const id = setInterval(paint, 250); // periodic safety refresh (cursor/status)
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [machine]);

  /* focus capture when program asks for input */
  useEffect(() => {
    if (snap.status === "waiting") {
      const t = setTimeout(() => wrapRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [snap.status, snap.waiting, snap.screenRev]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (machine.status !== "waiting") return;
    let code: number | null = null;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) code = e.key.charCodeAt(0);
    else if (e.key === "Enter") code = 13;
    else if (e.key === "Backspace") code = 8;
    if (code !== null) {
      e.preventDefault();
      machine.key(code);
    }
  };

  return (
    <section className="panel flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/[0.05] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-emerald-400/80" />
          <span className="panel-title">Console</span>
        </div>
        <div className="flex items-center gap-2">
          {snap.status === "waiting" && (
            <span className="flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-sky-300">
              <MousePointerClick size={10} />
              {snap.waiting === "line" ? "TYPE A LINE + ENTER" : "PRESS ANY KEY"}
            </span>
          )}
          <button
            onClick={() => {
              machine.screen.reset();
              machine.emit();
            }}
            title="Clear screen"
            className="grid h-6 w-6 place-items-center rounded-md border border-white/10 bg-black/30 text-zinc-500 transition-colors hover:border-white/20 hover:text-zinc-200"
          >
            <Eraser size={11} />
          </button>
        </div>
      </header>

      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn(
          "crt relative min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-3 outline-none transition-shadow",
          snap.status === "waiting" && "shadow-[inset_0_0_0_1px_rgba(56,189,248,0.25)]"
        )}
      >
        <div ref={preRef} className="relative z-10 font-mono text-[11px] text-emerald-300/95" />
        {/* CRT effects */}
        <div className="crt-scanlines pointer-events-none absolute inset-0 z-20 opacity-60" />
        <div className="crt-vignette pointer-events-none absolute inset-0 z-20" />
      </div>
        {snap.status === "waiting" && (
            <footer className="flex items-center justify-between border-t border-white/[0.05] px-3.5 py-1.5 font-mono text-[9px] tracking-wide text-zinc-600">
                <span className="text-sky-400">keyboard captured</span>
            </footer>
        )}
    </section>
  );
}
