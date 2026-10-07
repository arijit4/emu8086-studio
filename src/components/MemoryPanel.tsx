import { useMemo, useState } from "react";
import { MemoryStick, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LocateFixed } from "lucide-react";
import type { Machine, Snapshot } from "../emulator/machine";
import { cn, hex } from "../utils";

const ROWS = 8;
const COLS = 16;
const PAGE = ROWS * COLS;

type SegMode = "CS" | "DS" | "ES" | "SS" | "X";
const SEG_ORDER: Array<{ key: SegMode; idx: number | null }> = [
  { key: "CS", idx: 1 },
  { key: "DS", idx: 3 },
  { key: "ES", idx: 0 },
  { key: "SS", idx: 2 },
  { key: "X", idx: null },
];

function parseHex(s: string, fallback: number): number {
  const v = parseInt(s.replace(/[^0-9a-fA-F]/g, ""), 16);
  return Number.isFinite(v) ? v & 0xffff : fallback;
}

export default function MemoryPanel({
  machine,
  snap,
  minimized,
  onToggleMinimize,
}: {
  machine: Machine;
  snap: Snapshot;
  minimized: boolean;
  onToggleMinimize: () => void;
}) {
  const [segMode, setSegMode] = useState<SegMode>("DS");
  const [customSeg, setCustomSeg] = useState("0800");
  const [offStr, setOffStr] = useState("0000");

  const segVal = ((): number => {
    const def = SEG_ORDER.find((s) => s.key === segMode);
    if (def && def.idx !== null) return snap.segs[def.idx];
    return parseHex(customSeg, 0x0800);
  })();

  const base = parseHex(offStr, 0) & 0xfff0;
  const writes = useMemo(() => new Set(snap.writes), [snap.writes]);
  const labelAt = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of snap.dataLabels) m.set(l.offset, l.name);
    return m;
  }, [snap.dataLabels]);

  const mem = machine.cpu.mem;
  const physBase = (segVal << 4) + base;

  const goPage = (dir: number) => {
    const next = (base + dir * PAGE) & 0xffff;
    setOffStr(hex(next));
  };

  const followSP = () => {
    setSegMode("SS");
    setOffStr(hex(snap.regs[4] & 0xfff0));
  };

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="hairline-glow" />
      <header className="flex flex-wrap items-center gap-2 border-b border-white/[0.05] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <MemoryStick size={12} className="text-sky-400/80" />
          <span className="panel-title">Memory</span>
        </div>
        {!minimized && <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* segment preset */}
          <div className="flex overflow-hidden rounded-md border border-white/10">
            {SEG_ORDER.map((s) => (
              <button
                key={s.key}
                onClick={() => setSegMode(s.key)}
                className={cn(
                  "px-2 py-1 font-mono text-[10px] font-bold transition-colors",
                  segMode === s.key ? "bg-sky-500/20 text-sky-300" : "bg-black/30 text-zinc-500 hover:text-zinc-300"
                )}
              >
                {s.key}
              </button>
            ))}
          </div>
          {segMode === "X" && (
            <input
              value={customSeg}
              onChange={(e) => setCustomSeg(e.target.value.toUpperCase())}
              className="h-[26px] w-16 rounded-md border border-white/10 bg-black/40 px-1.5 font-mono text-[10px] text-sky-300 outline-none focus:border-sky-400/50"
              maxLength={4}
              spellCheck={false}
            />
          )}
          <span className="font-mono text-[11px] text-zinc-600">:</span>
          <input
            value={offStr}
            onChange={(e) => setOffStr(e.target.value.toUpperCase())}
            className="h-[26px] w-16 rounded-md border border-white/10 bg-black/40 px-1.5 font-mono text-[10px] text-sky-300 outline-none focus:border-sky-400/50"
            maxLength={4}
            spellCheck={false}
            title="Offset (hex)"
          />
          <button onClick={() => goPage(-1)} title="Previous page" className="grid h-[26px] w-[26px] place-items-center rounded-md border border-white/10 bg-black/30 text-zinc-400 transition-colors hover:text-zinc-100">
            <ChevronLeft size={12} />
          </button>
          <button onClick={() => goPage(1)} title="Next page" className="grid h-[26px] w-[26px] place-items-center rounded-md border border-white/10 bg-black/30 text-zinc-400 transition-colors hover:text-zinc-100">
            <ChevronRight size={12} />
          </button>
          <button onClick={followSP} title="Follow stack pointer" className="grid h-[26px] w-[26px] place-items-center rounded-md border border-white/10 bg-black/30 text-zinc-400 transition-colors hover:text-emerald-300">
            <LocateFixed size={12} />
          </button>
        </div>}
        <button
          onClick={onToggleMinimize}
          aria-expanded={!minimized}
          title={minimized ? "Expand memory panel" : "Minimize memory panel"}
          className={cn(
            "grid h-[26px] w-[26px] place-items-center rounded-md border border-white/10 bg-black/30 text-zinc-400 transition-colors hover:text-zinc-100",
            minimized && "ml-auto"
          )}
        >
          {minimized ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </header>

      {!minimized && <div className="min-h-0 flex-1 overflow-auto p-2.5">
        <table className="w-full border-collapse font-mono text-[11.5px] leading-[1.55]">
          <tbody>
            {Array.from({ length: ROWS }).map((_, r) => {
              const rowOff = (base + r * COLS) & 0xffff;
              const rowPhys = (physBase + r * COLS) & 0xfffff;
              const label = segMode === "DS" ? labelAt.get(rowOff) : undefined;
              return (
                <tr key={r} className="group/row">
                  <td className="w-[92px] select-none whitespace-nowrap pr-2 text-right text-zinc-600">
                    {hex(segVal)}<span className="text-zinc-700">:</span>{hex(rowOff)}
                  </td>
                  <td className="whitespace-nowrap">
                    {Array.from({ length: COLS }).map((_, c) => {
                      const p = (rowPhys + c) & 0xfffff;
                      const v = mem[p];
                      const hit = writes.has(p);
                      return (
                        <span
                          key={c}
                          title={`${hex(segVal)}:${hex((rowOff + c) & 0xffff)} = ${v.toString(10)}`}
                          className={cn(
                            "inline-block w-[26px] rounded-[3px] text-center",
                            hit ? "bg-sky-400/20 text-sky-200" : v === 0 ? "text-zinc-700" : "text-zinc-300",
                            c === 7 && "mr-3"
                          )}
                        >
                          {hex(v, 2)}
                        </span>
                      );
                    })}
                  </td>
                  <td className="hidden w-[150px] select-none whitespace-pre pl-2 text-zinc-600 xl:table-cell">
                    {Array.from({ length: COLS }).map((_, c) => {
                      const v = mem[(rowPhys + c) & 0xfffff];
                      return v >= 32 && v < 127 ? String.fromCharCode(v) : "·";
                    })}
                    {label && (
                      <span className="ml-2 rounded border border-pink-400/30 bg-pink-500/10 px-1 text-[9px] font-bold tracking-wider text-pink-300">
                        {label}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}

      {!minimized && <footer className="flex items-center justify-between border-t border-white/[0.05] px-3.5 py-1.5 font-mono text-[9px] tracking-wide text-zinc-600">
        <span>1 MB address space · physical {hex(physBase, 5)}H</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-[2px] bg-sky-400/30" /> written this step
        </span>
      </footer>}
    </section>
  );
}
