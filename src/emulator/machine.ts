/* ------------------------------------------------------------------
 * Machine: owns the CPU, the screen, the run loop and input queue.
 * UI subscribes via `subscribe()` and reads `snapshot()`.
 * ------------------------------------------------------------------ */

import { AsmError, Program, assemble, EMU } from "./assembler";
import { CPU, CpuError, IOBridge, NeedInput } from "./cpu";

export type Status = "idle" | "running" | "paused" | "waiting" | "halted" | "error";

/* one reversible execution record */
interface HistoryEntry {
  regs: Uint16Array;
  segs: Uint16Array;
  flags: number;
  ip: number;
  cycles: number;
  halted: boolean;
  lineReady: boolean;
  undo: number[]; // flattened [addr, oldValue, ...]
  inputQueue: number[];
  /* Only the tail of the screen is journaled: output is written at (or after)
     the cursor row, so copying the whole buffer would waste megabytes. */
  screen: { from: number; rows: string[]; sys: boolean[]; len: number; row: number; col: number } | null;
}

const HISTORY_LIMIT = 4000;
const SCREEN_WINDOW_BACK = 3; // rows above the cursor kept in each journal entry
/* above this speed the undo journal is skipped (allocation would dominate) */
export const HISTORY_MAX_SPEED = 25000;

export interface Snapshot {
  status: Status;
  regs: number[]; // AX CX DX BX SP BP SI DI
  segs: number[]; // ES CS SS DS
  flags: number;
  ipIdx: number;
  ipAddr: number;
  execLine: number | null; // 1-based source line
  current: string;
  cycles: number;
  codeBytes: number;
  dataBytes: number;
  dataLabels: Array<{ name: string; offset: number }>;
  writes: number[];
  screenRev: number;
  errors: AsmError[];
  dirty: boolean;
  waiting: "char" | "line" | null;
  message: string;
  canStepBack: boolean;
  historyDepth: number;
}

/* ---------------- DOS screen model ---------------- */

const MAX_ROWS = 2000;

export class Screen {
  rows: string[] = [""];
  sys: boolean[] = [false];
  row = 0;
  col = 0;
  rev = 0;

  reset() {
    this.rows = [""];
    this.sys = [false];
    this.row = 0;
    this.col = 0;
    this.rev++;
  }

  private ensure() {
    while (this.row >= this.rows.length) {
      this.rows.push("");
      this.sys.push(false);
    }
    if (this.rows.length > MAX_ROWS) {
      const cut = this.rows.length - MAX_ROWS;
      this.rows.splice(0, cut);
      this.sys.splice(0, cut);
      this.row -= cut;
    }
  }

  putChar(c: number) {
    c &= 0xff;
    if (c === 13) {
      this.col = 0;
      this.rev++;
      return;
    }
    if (c === 10) {
      this.row++;
      this.ensure();
      this.rev++;
      return;
    }
    if (c === 8) {
      if (this.col > 0) this.col--;
      this.rev++;
      return;
    }
    if (c === 9) {
      this.col = (this.col + 8) & ~7;
      this.rev++;
      return;
    }
    if (c === 7) {
      this.rev++;
      return; // bell: silent
    }
    this.ensure();
    let line = this.rows[this.row];
    if (this.col > line.length) line = line.padEnd(this.col, " ");
    const ch = c >= 32 ? String.fromCharCode(c) : " ";
    line = line.slice(0, this.col) + ch + line.slice(this.col + 1);
    this.rows[this.row] = line;
    this.col++;
    this.rev++;
  }

  writeString(s: string) {
    for (let i = 0; i < s.length; i++) this.putChar(s.charCodeAt(i));
  }

  system(msg: string) {
    this.ensure();
    // never overwrite a partially-written output line — start on a fresh row
    if (this.rows[this.row].length > 0 || this.col > 0) {
      this.row++;
      this.col = 0;
      this.ensure();
    }
    this.rows[this.row] = msg;
    this.sys[this.row] = true;
    this.row++;
    this.col = 0;
    this.ensure();
    this.rev++;
  }

  clear() {
    this.reset();
  }
}

/* ---------------- Machine ---------------- */

export class Machine {
  screen = new Screen();
  cpu: CPU;
  status: Status = "idle";
  program: Program | null = null;
  errors: AsmError[] = [];
  source = "";
  assembledSource = "";
  speed = 2000; // instructions per second
  message = "ready";

  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private history: HistoryEntry[] = [];
  private inputQueue: number[] = [];
  private waiting: "char" | "line" | null = null;
  private statusBeforeWait: Status = "paused";
  private pendingInput: NeedInput | null = null;
  private lineBuf: number[] = [];
  private emitScheduled = false;

  constructor() {
    const io: IOBridge = {
      writeChar: (c) => {
        this.screen.putChar(c);
        this.scheduleEmit();
      },
      writeString: (s) => {
        this.screen.writeString(s);
        this.scheduleEmit();
      },
      inputAvailable: () => this.inputQueue.length > 0,
      readChar: () => this.inputQueue.shift() ?? 0,
      peekChar: () => (this.inputQueue.length > 0 ? this.inputQueue[0] : -1),
      clearInput: () => {
        this.inputQueue = [];
      },
      setCursor: (r, c) => {
        this.screen.row = Math.max(0, Math.min(r, 200));
        this.screen.col = Math.max(0, c);
        this.screen.rev++;
        this.scheduleEmit();
      },
      getCursor: () => ({ row: this.screen.row, col: this.screen.col }),
      clearScreen: () => {
        this.screen.reset();
        this.scheduleEmit();
      },
      systemMessage: (m) => {
        this.screen.system(m);
        this.scheduleEmit();
      },
    };
    this.cpu = new CPU(io);
  }

  /* ---------- pub/sub ---------- */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn();
  }
  private scheduleEmit() {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    requestAnimationFrame(() => {
      this.emitScheduled = false;
      this.emit();
    });
  }

  /* ---------- assembly & lifecycle ---------- */
  setSource(src: string) {
    this.source = src;
    this.emit();
  }

  get dirty(): boolean {
    return this.source !== this.assembledSource;
  }

  assemble(src?: string): boolean {
    if (src !== undefined) this.source = src;
    this.stopTimer();
    const p = assemble(this.source);
    this.program = p.ok ? p : null;
    this.errors = p.errors;
    this.assembledSource = this.source;
    this.waiting = null;
    this.pendingInput = null;
    this.inputQueue = [];
    this.lineBuf = [];
    this.cpu.writes = [];
    this.history = [];

    this.screen.reset();
    if (!p.ok) {
      this.status = "error";
      this.message = `${p.errors.length} assembly error${p.errors.length === 1 ? "" : "s"}`;
      this.screen.system(`[emu8086] assembly failed with ${p.errors.length} error(s) — see the editor panel`);
      this.emit();
      return false;
    }
    this.cpu.reset(p);
    this.status = "idle";
    this.message = `assembled — ${p.codeBytes} code bytes, ${p.data.length} data bytes`;
    this.screen.system(
      `[emu8086] assembled ok — code ${p.codeBytes}B / data ${p.data.length}B / stack ${p.stackSize.toString(16).toUpperCase()}H`
    );
    this.screen.system(`[emu8086] entry CS:${(0x100 + p.entryIndex * 4).toString(16).toUpperCase()} — press Run or Step`);
    this.emit();
    return true;
  }

  private ensureReady(): boolean {
    if (this.status === "halted" || this.status === "error" || !this.program || this.dirty) {
      return this.assemble();
    }
    return true;
  }

  reset() {
    this.assemble();
  }

  run() {
    if (this.status === "running") return;
    if (!this.ensureReady()) return;
    if (this.status === "waiting") return; // resumes on key
    this.status = "running";
    this.message = "running";
    this.startTimer();
    this.emit();
  }

  pause() {
    if (this.status !== "running") return;
    this.stopTimer();
    this.status = "paused";
    this.message = `paused after ${this.cpu.cycles.toLocaleString()} instructions`;
    this.emit();
  }

  step() {
    if (this.status === "running") return;
    if (!this.ensureReady()) return;
    if (this.status === "waiting") return;
    this.execOne("paused");
    this.emit();
  }

  /* history is skipped at high speed so the run loop stays allocation-free */
  get historyEnabled(): boolean {
    return this.speed <= HISTORY_MAX_SPEED;
  }

  private captureScreenWindow() {
    const s = this.screen;
    const from = Math.max(0, s.row - SCREEN_WINDOW_BACK);
    return {
      from,
      rows: s.rows.slice(from),
      sys: s.sys.slice(from),
      len: s.rows.length,
      row: s.row,
      col: s.col,
    };
  }

  private captureHistory() {
    const cpu = this.cpu;
    const p = this.program;
    const ins = p && cpu.ip >= 0 && cpu.ip < p.instructions.length ? p.instructions[cpu.ip] : null;
    // the console can only change on INT / HLT, so snapshot it lazily
    const touchesScreen = !ins || ins.op === "INT" || ins.op === "HLT" || ins.op === "OUT";
    const entry: HistoryEntry = {
      regs: cpu.r.slice(),
      segs: cpu.s.slice(),
      flags: cpu.F,
      ip: cpu.ip,
      cycles: cpu.cycles,
      halted: cpu.halted,
      lineReady: cpu.lineReady,
      undo: [],
      inputQueue: this.inputQueue.slice(),
      screen: touchesScreen ? this.captureScreenWindow() : null,
    };
    cpu.undoLog = entry.undo;
    cpu.recording = true;
    this.history.push(entry);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  /* reverse the most recent instruction */
  stepBack(): boolean {
    if (this.status === "running") this.pause();
    const entry = this.history.pop();
    if (!entry) {
      this.message = "nothing to step back to";
      this.emit();
      return false;
    }
    const cpu = this.cpu;
    // restore memory by replaying the write journal backwards
    for (let i = entry.undo.length - 2; i >= 0; i -= 2) {
      cpu.mem[entry.undo[i]] = entry.undo[i + 1];
      if (cpu.writes.length < 4096) cpu.writes.push(entry.undo[i]);
    }
    cpu.r.set(entry.regs);
    cpu.s.set(entry.segs);
    cpu.F = entry.flags;
    cpu.ip = entry.ip;
    cpu.cycles = entry.cycles;
    cpu.halted = entry.halted;
    cpu.lineReady = entry.lineReady;
    this.inputQueue = entry.inputQueue.slice();
    if (entry.screen) {
      const w = entry.screen;
      this.screen.rows.length = w.len;
      this.screen.sys.length = w.len;
      for (let i = 0; i < w.rows.length; i++) {
        this.screen.rows[w.from + i] = w.rows[i];
        this.screen.sys[w.from + i] = w.sys[i];
      }
      this.screen.row = w.row;
      this.screen.col = w.col;
      this.screen.rev++;
    }
    this.waiting = null;
    this.pendingInput = null;
    this.status = "paused";
    this.message = `stepped back — ${cpu.cycles.toLocaleString()} instructions executed`;
    this.emit();
    return true;
  }

  private execOne(fallbackStatus: Status) {
    try {
      if (this.historyEnabled) this.captureHistory();
      else if (this.history.length) this.history.length = 0;
      this.cpu.step();
      this.cpu.recording = false;
      if (this.cpu.halted) {
        this.status = "halted";
        this.message = `halted after ${this.cpu.cycles.toLocaleString()} instructions`;
        this.stopTimer();
        this.scheduleEmit();
      } else {
        this.status = fallbackStatus === "running" ? "running" : "paused";
        this.message = fallbackStatus === "running" ? "running" : "paused — stepping";
      }
    } catch (e) {
      this.cpu.recording = false;
      // the instruction did not complete — drop its (empty) history record so
      // it is not counted twice when it is retried after input arrives
      if (e instanceof NeedInput || e instanceof CpuError) this.history.pop();
      if (e instanceof NeedInput) {
        this.handleNeedInput(e, fallbackStatus);
      } else if (e instanceof CpuError) {
        this.stopTimer();
        this.status = "error";
        this.message = e.message;
        this.screen.system(`[emu8086] fault: ${e.message}`);
        this.scheduleEmit();
      } else {
        this.stopTimer();
        this.status = "error";
        this.message = "internal emulator error";
        this.screen.system(`[emu8086] internal error: ${String(e)}`);
        this.scheduleEmit();
        throw e;
      }
    }
  }

  private handleNeedInput(n: NeedInput, fallbackStatus: Status) {
    this.statusBeforeWait = fallbackStatus === "running" ? "running" : "paused";
    this.pendingInput = n;
    if (n.kind === "line") {
      this.waiting = "line";
      this.lineBuf = [];
      const max = n.max;
      this.message = `waiting for input line (AH=0Ah, max ${max})`;
    } else {
      this.waiting = "char";
      this.message = n.echo ? "waiting for a key (input with echo)" : "waiting for a key (no echo)";
    }
    this.status = "waiting";
    this.stopTimer();
    this.scheduleEmit();
  }

  /* ---------- run loop ---------- */
  private startTimer() {
    this.stopTimer();
    this.credit = 0;
    this.timer = setInterval(() => this.tick(), 16);
  }
  private stopTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private credit = 0; // fractional instruction budget for sub-frame speeds

  private tick() {
    if (this.status !== "running") {
      this.stopTimer();
      return;
    }
    this.credit += this.speed / 60;
    const quota = Math.floor(this.credit);
    if (quota < 1) {
      this.scheduleEmit();
      return;
    }
    this.credit -= quota;
    const deadline = performance.now() + 11;
    let executed = 0;
    while (executed < quota && performance.now() < deadline) {
      this.execOne("running");
      executed++;
      if (this.status !== "running") break;
    }
    this.scheduleEmit();
  }

  /* ---------- keyboard input ---------- */
  key(code: number) {
    code &= 0xff;
    if (this.waiting === "line" && this.pendingInput) {
      const max = Math.max(1, this.pendingInput.max);
      if (code === 13) {
        // finish line input: write count + chars into DS:DX buffer
        const base = this.pendingInput.segAddr;
        this.cpu.wr8(base + 1, this.lineBuf.length);
        for (let i = 0; i < this.lineBuf.length; i++) this.cpu.wr8(base + 2 + i, this.lineBuf[i]);
        this.cpu.wr8(base + 2 + this.lineBuf.length, 13);
        this.cpu.lineReady = true;
        this.screen.putChar(10);
        this.finishWaiting();
      } else if (code === 8) {
        if (this.lineBuf.length > 0) {
          this.lineBuf.pop();
          this.screen.putChar(8);
          this.screen.putChar(32);
          this.screen.putChar(8);
        }
      } else if (code >= 32) {
        const cap = Math.max(1, max - 1);
        if (this.lineBuf.length < cap) {
          this.lineBuf.push(code);
          this.screen.putChar(code);
        }
      }
      this.scheduleEmit();
      return;
    }
    if (this.waiting === "char") {
      this.inputQueue.push(code);
      if (this.inputQueue.length > 31) this.inputQueue.shift();
      this.finishWaiting();
      return;
    }
    // queue for polled input
    if (this.inputQueue.length < 32) this.inputQueue.push(code);
  }

  private finishWaiting() {
    const resume = this.statusBeforeWait;
    this.waiting = null;
    this.pendingInput = null;
    this.status = resume === "running" ? "running" : "paused";
    this.scheduleEmit();
    if (resume === "running") {
      this.startTimer();
    } else {
      // complete the single blocked instruction
      this.execOne("paused");
      this.scheduleEmit();
    }
  }

  /* ---------- snapshot ---------- */
  snapshot(): Snapshot {
    const cpu = this.cpu;
    const p = this.program;
    const len = p ? p.instructions.length : 0;
    const insIdx = p && len > 0 && cpu.ip >= 0 ? Math.min(cpu.ip, len - 1) : -1;
    const ins = insIdx >= 0 && p ? p.instructions[insIdx] : null;
    const writes = cpu.writes;
    cpu.writes = [];
    return {
      status: this.status,
      regs: Array.from(cpu.r),
      segs: Array.from(cpu.s),
      flags: cpu.F,
      ipIdx: insIdx,
      ipAddr: ins ? ins.addr : EMU.IP_INIT,
      execLine: ins ? ins.line : null,
      current: ins ? ins.raw : "—",
      cycles: cpu.cycles,
      codeBytes: p ? p.codeBytes : 0,
      dataBytes: p ? p.data.length : 0,
      dataLabels: p ? p.labelList : [],
      writes,
      screenRev: this.screen.rev,
      errors: this.errors,
      dirty: this.dirty,
      waiting: this.waiting,
      message: this.message,
      canStepBack: this.history.length > 0,
      historyDepth: this.history.length,
    };
  }
}
