import { useEffect, useRef, useState } from "react";
import { Cpu, Binary, ChevronDown, ChevronUp, Flag } from "lucide-react";
import type { Snapshot } from "../emulator/machine";
import { cn, hex, bin } from "../utils";

/* Highlight a value only when it changed in the latest machine snapshot. */
function useChanged(v: number, changeKey: number): boolean {
  const ref = useRef(v);
  const [changed, setChanged] = useState(false);
  const keyRef = useRef(changeKey);

  useEffect(() => {
    if (keyRef.current !== changeKey) {
      setChanged(ref.current !== v);
      ref.current = v;
      keyRef.current = changeKey;
    }
  }, [changeKey, v]);

  return changed;
}

function Cell({
  value,
  w = 4,
  mode,
  changeKey,
  className,
  dim,
}: {
  value: number;
  w?: number;
  mode: "hex" | "dec" | "bin";
  changeKey: number;
  className?: string;
  dim?: boolean;
}) {
  const changed = useChanged(value, changeKey);
  const txt =
    mode === "hex"
      ? hex(value, w)
      : mode === "dec"
        ? value.toString(10).padStart(w === 2 ? 3 : 5, "\u2007")
        : bin(value, w === 2 ? 8 : 16);
  return (
    <span
      key={value}
      className={cn(
        "tabular-nums",
        dim && value === 0 ? "text-zinc-600" : "text-zinc-200",
        changed && "cell-flash",
        className
      )}
    >
      {txt}
    </span>
  );
}

/* ---------------- general register table ---------------- */

const GP = [
  { name: "AX", i: 0, hi: "AH", lo: "AL" },
  { name: "BX", i: 3, hi: "BH", lo: "BL" },
  { name: "CX", i: 1, hi: "CH", lo: "CL" },
  { name: "DX", i: 2, hi: "DH", lo: "DL" },
];

function GeneralTable({ regs, binMode, changeKey }: { regs: number[]; binMode: boolean; changeKey: number }) {
  return (
    <table className="w-full table-fixed border-collapse font-mono text-[11px]">
      <thead>
        <tr className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-zinc-600">
          <th className="w-[34px] py-0.5 text-left font-bold">Reg</th>
          <th className="py-0.5 text-right font-bold">{binMode ? "Binary" : "Hex"}</th>
          <th className="w-[52px] py-0.5 text-right font-bold">Dec</th>
          {!binMode && (
            <>
              <th className="w-[40px] py-0.5 text-right font-bold">Hi</th>
              <th className="w-[40px] py-0.5 text-right font-bold">Lo</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {GP.map((g) => {
          const v = regs[g.i];
          return (
            <tr key={g.name} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
              <td className="py-[3px] text-left font-bold tracking-wider text-emerald-400/70">{g.name}</td>
              <td className="py-[3px] text-right">
                <Cell value={v} mode={binMode ? "bin" : "hex"} changeKey={changeKey} />
                {!binMode && <span className="text-zinc-600">h</span>}
              </td>
              <td className="py-[3px] text-right">
                <Cell value={v} mode="dec" changeKey={changeKey} className="text-zinc-400" dim />
              </td>
              {!binMode && (
                <>
                  <td className="py-[3px] text-right">
                    <Cell value={(v >> 8) & 0xff} w={2} mode="hex" changeKey={changeKey} className="text-zinc-400" dim />
                  </td>
                  <td className="py-[3px] text-right">
                    <Cell value={v & 0xff} w={2} mode="hex" changeKey={changeKey} className="text-zinc-400" dim />
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------------- segment / pointer table ---------------- */

function PairTable({
  title,
  rows,
  changeKey,
}: {
  title: string;
  rows: Array<{ name: string; value: number; accent?: boolean }>;
  changeKey: number;
}) {
  return (
    <table className="w-full table-fixed border-collapse font-mono text-[11px]">
      <thead>
        <tr className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-zinc-600">
          <th className="w-[30px] py-0.5 text-left font-bold">{title}</th>
          <th className="py-0.5 text-right font-bold">Hex</th>
          <th className="py-0.5 text-right font-bold">Dec</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
            <td
              className={cn(
                "py-[3px] text-left font-bold tracking-wider",
                r.accent ? "text-emerald-400/70" : "text-zinc-500"
              )}
            >
              {r.name}
            </td>
            <td className="py-[3px] text-right">
              <Cell value={r.value} mode="hex" changeKey={changeKey} />
              <span className="text-zinc-600">h</span>
            </td>
            <td className="py-[3px] text-right">
              <Cell value={r.value} mode="dec" changeKey={changeKey} className="text-zinc-400" dim />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- flags ---------------- */

const FLAG_DEFS: Array<{ name: string; bit: number; full: string }> = [
  { name: "OF", bit: 11, full: "Overflow Flag" },
  { name: "DF", bit: 10, full: "Direction Flag" },
  { name: "IF", bit: 9, full: "Interrupt-enable Flag" },
  { name: "TF", bit: 8, full: "Trap Flag" },
  { name: "SF", bit: 7, full: "Sign Flag" },
  { name: "ZF", bit: 6, full: "Zero Flag" },
  { name: "AF", bit: 4, full: "Auxiliary Carry Flag" },
  { name: "PF", bit: 2, full: "Parity Flag" },
  { name: "CF", bit: 0, full: "Carry Flag" },
];

function FlagTable({ flags, changeKey }: { flags: number; changeKey: number }) {
  return (
    <table className="w-full table-fixed border-collapse text-center font-mono">
      <thead>
        <tr>
          {FLAG_DEFS.map((f) => {
            const on = (flags >> f.bit) & 1;
            return (
              <th
                key={f.name}
                title={`${f.full} — bit ${f.bit}`}
                className={cn(
                  "cursor-help border border-white/[0.05] py-[3px] text-[8.5px] font-bold tracking-wider",
                  on ? "border-emerald-400/20 bg-emerald-500/[0.07] text-emerald-400/90" : "bg-black/20 text-zinc-600"
                )}
              >
                {f.name}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        <tr>
          {FLAG_DEFS.map((f) => {
            const on = (flags >> f.bit) & 1;
            return <FlagCell key={f.name} on={on} changeKey={changeKey} />;
          })}
        </tr>
      </tbody>
    </table>
  );
}

function FlagCell({ on, changeKey }: { on: number; changeKey: number }) {
  const changed = useChanged(on, changeKey);
  return (
    <td
      className={cn(
        "border border-white/[0.05] py-[3px] text-[12px] font-semibold",
        on ? "border-emerald-400/20 bg-emerald-500/[0.07]" : "bg-black/20"
      )}
    >
      <span
        key={on}
        className={cn(
          on ? "text-emerald-300 [text-shadow:0_0_8px_rgba(52,211,153,0.55)]" : "text-zinc-700",
          changed && "cell-flash"
        )}
      >
        {on}
      </span>
    </td>
  );
}

/* ---------------- panel ---------------- */

export default function CpuPanel({
  snap,
  minimized,
  onToggleMinimize,
}: {
  snap: Snapshot;
  minimized: boolean;
  onToggleMinimize: () => void;
}) {
  const [binMode, setBinMode] = useState(false);
  const r = snap.regs; // AX CX DX BX SP BP SI DI
  const s = snap.segs; // ES CS SS DS
  const changeKey = snap.cycles;

  return (
    <section className="panel flex h-full flex-col overflow-hidden">
      <div className="hairline-glow" />
      <header className="flex items-center justify-between border-b border-white/[0.05] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Cpu size={11} className="text-emerald-400/80" />
          <span className="panel-title">Central Processing Unit (CPU)</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!minimized && <button
            onClick={() => setBinMode((v) => !v)}
            title="Toggle hexadecimal / binary view"
            className={cn(
              "flex h-[22px] items-center gap-1 rounded border px-1.5 font-mono text-[9px] font-bold transition-colors",
              binMode
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 text-zinc-500 hover:text-zinc-300"
            )}
          >
            <Binary size={9} />
            {binMode ? "BIN" : "HEX"}
          </button>}
          <button
            onClick={onToggleMinimize}
            aria-expanded={!minimized}
            title={minimized ? "Expand CPU panel" : "Minimize CPU panel"}
            className="grid h-[22px] w-[22px] place-items-center rounded border border-white/10 text-zinc-500 transition-colors hover:text-zinc-300"
          >
            {minimized ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
        </div>
      </header>

      {!minimized && <div className="space-y-2 px-2.5 py-2">
        {/* general registers */}
        <GeneralTable regs={r} binMode={binMode} changeKey={changeKey} />

        {/* segments + pointers side by side */}
        <div className="flex gap-3 border-t border-white/[0.05] pt-1.5">
          <div className="flex-1">
            <PairTable
              title="Seg"
              changeKey={changeKey}
              rows={[
                { name: "CS", value: s[1] },
                { name: "DS", value: s[3], accent: true },
                { name: "ES", value: s[0] },
                { name: "SS", value: s[2] },
              ]}
            />
          </div>
          <div className="w-px bg-white/[0.05]" />
          <div className="flex-1">
            <PairTable
              title="Ptr"
              changeKey={changeKey}
              rows={[
                { name: "IP", value: snap.ipAddr, accent: true },
                { name: "SP", value: r[4] },
                { name: "BP", value: r[5] },
                { name: "SI", value: r[6] },
                { name: "DI", value: r[7] },
              ]}
            />
          </div>
        </div>

        {/* flags */}
        <div className="border-t border-white/[0.05] pt-1.5">
          <p className="mb-1 flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.18em] text-zinc-600">
            <Flag size={8} />
            Flags
            <span className="ml-auto font-mono font-medium normal-case tracking-normal text-zinc-700">
              {hex(snap.flags, 4)}h
            </span>
          </p>
          <FlagTable flags={snap.flags} changeKey={changeKey} />
        </div>
      </div>}
    </section>
  );
}
