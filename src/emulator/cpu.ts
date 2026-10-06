/* ------------------------------------------------------------------
 * 8086 CPU interpreter: registers, flags, 1MB memory, interrupts.
 * Executes the pseudo-assembled Program produced by assembler.ts.
 * ------------------------------------------------------------------ */

import { EMU, Instruction, Operand, Program } from "./assembler";

/* flag bit positions */
export const F = { CF: 0, PF: 2, AF: 4, ZF: 6, SF: 7, TF: 8, IF: 9, DF: 10, OF: 11 } as const;

export class CpuError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CpuError";
  }
}

export class NeedInput {
  constructor(
    public kind: "char" | "line",
    public echo: boolean,
    public segAddr = 0, // physical address of buffer (line mode)
    public max = 0
  ) {}
}

export interface IOBridge {
  writeChar(c: number): void;
  writeString(s: string): void;
  inputAvailable(): boolean;
  readChar(): number; // consume queued key
  peekChar(): number; // -1 when empty
  clearInput(): void;
  setCursor(row: number, col: number): void;
  getCursor(): { row: number; col: number };
  clearScreen(): void;
  systemMessage(msg: string): void;
}

const hex2 = (v: number) => (v & 0xff).toString(16).toUpperCase().padStart(2, "0");

export class CPU {
  r = new Uint16Array(8); // AX CX DX BX SP BP SI DI
  s = new Uint16Array(4); // ES CS SS DS
  F = 0x0002;
  ip = 0; // index into program.instructions
  mem = new Uint8Array(0x100000);
  halted = false;
  cycles = 0;
  writes: number[] = []; // physical addresses written since last drain
  lineReady = false; // buffered input completed by the machine
  recording = false; // capture undo deltas for step-back
  undoLog: number[] = []; // flattened [addr, oldValue, ...]
  program: Program | null = null;
  io: IOBridge;
  private nextIp = 0;
  private branched = false;

  constructor(io: IOBridge) {
    this.io = io;
  }

  reset(program: Program) {
    this.program = program;
    this.r.fill(0);
    this.s[0] = EMU.ES_INIT; // ES
    this.s[1] = EMU.CS_INIT; // CS
    this.s[2] = EMU.SS_INIT; // SS
    this.s[3] = EMU.DATA_SEG_VALUE; // DS (= @DATA, like the emu8086 default)
    this.r[4] = program.stackSize; // SP
    this.F = 0x0002;
    this.ip = program.entryIndex;
    this.halted = false;
    this.cycles = 0;
    this.mem.fill(0);
    this.writes = [];
    this.lineReady = false;
    this.undoLog = [];
    const base = EMU.DATA_SEG_VALUE * 16;
    for (let i = 0; i < program.data.length && base + i < this.mem.length; i++) {
      this.mem[base + i] = program.data[i] & 0xff;
    }
  }

  /* ---------- flags ---------- */
  flag(b: number): number {
    return (this.F >> b) & 1;
  }
  setFlag(b: number, v: boolean | number) {
    if (v) this.F |= 1 << b;
    else this.F &= ~(1 << b);
  }
  private szp(v: number, size: 8 | 16) {
    const mask = size === 8 ? 0xff : 0xffff;
    v &= mask;
    this.setFlag(F.ZF, v === 0);
    this.setFlag(F.SF, (v & (size === 8 ? 0x80 : 0x8000)) !== 0);
    let x = v & 0xff;
    x ^= x >> 4;
    x &= 0xf;
    this.setFlag(F.PF, ((0x6996 >> x) & 1) === 0);
  }
  private setAddFlags(a: number, b: number, carryIn: number, size: 8 | 16): number {
    const mask = size === 8 ? 0xff : 0xffff;
    const msb = size === 8 ? 0x80 : 0x8000;
    const full = a + b + carryIn;
    const res = full & mask;
    this.setFlag(F.CF, full > mask);
    this.setFlag(F.AF, ((a ^ (b + carryIn) ^ res) & 0x10) !== 0);
    const t = (b + carryIn) & mask;
    this.setFlag(F.OF, (~(a ^ t) & (a ^ res) & msb) !== 0);
    this.szp(res, size);
    return res;
  }
  private setSubFlags(a: number, b: number, carryIn: number, size: 8 | 16): number {
    const mask = size === 8 ? 0xff : 0xffff;
    const msb = size === 8 ? 0x80 : 0x8000;
    const full = a - b - carryIn;
    const res = full & mask;
    this.setFlag(F.CF, full < 0);
    this.setFlag(F.AF, ((a ^ b ^ res) & 0x10) !== 0);
    this.setFlag(F.OF, ((a ^ b) & (a ^ res) & msb) !== 0);
    this.szp(res, size);
    return res;
  }
  private setLogicFlags(v: number, size: 8 | 16): number {
    this.setFlag(F.CF, 0);
    this.setFlag(F.OF, 0);
    this.setFlag(F.AF, 0);
    const mask = size === 8 ? 0xff : 0xffff;
    const res = v & mask;
    this.szp(res, size);
    return res;
  }

  /* ---------- register / memory access ---------- */
  getReg16(i: number): number {
    return this.r[i];
  }
  getReg8(i: number): number {
    const v = this.r[i & 3];
    return i < 4 ? v & 0xff : (v >> 8) & 0xff;
  }
  setReg16(i: number, v: number) {
    this.r[i] = v & 0xffff;
  }
  setReg8(i: number, v: number) {
    v &= 0xff;
    if (i < 4) this.r[i] = (this.r[i] & 0xff00) | v;
    else this.r[i & 3] = (this.r[i & 3] & 0x00ff) | (v << 8);
  }

  phys(segVal: number, off: number): number {
    return ((segVal << 4) + (off & 0xffff)) & 0xfffff;
  }
  rd8(p: number): number {
    return this.mem[p & 0xfffff];
  }
  wr8(p: number, v: number) {
    const a = p & 0xfffff;
    if (this.recording) {
      this.undoLog.push(a, this.mem[a]);
    }
    this.mem[a] = v & 0xff;
    if (this.writes.length < 4096) this.writes.push(a);
  }
  rd16(p: number): number {
    return this.rd8(p) | (this.rd8(p + 1) << 8);
  }
  wr16(p: number, v: number) {
    this.wr8(p, v);
    this.wr8(p + 1, v >> 8);
  }

  private memAddr(o: Extract<Operand, { kind: "mem" }>): number {
    const segVal =
      o.seg !== null ? this.s[o.seg] : o.base === 5 ? this.s[2] /*SS*/ : this.s[3] /*DS*/;
    const off = (o.disp + (o.base !== null ? this.r[o.base] : 0) + (o.index !== null ? this.r[o.index] : 0)) & 0xffff;
    return this.phys(segVal, off);
  }
  memOffset(o: Extract<Operand, { kind: "mem" }>): number {
    return (o.disp + (o.base !== null ? this.r[o.base] : 0) + (o.index !== null ? this.r[o.index] : 0)) & 0xffff;
  }

  private sizeOf(o: Operand, fallback?: 8 | 16): 8 | 16 {
    if (o.kind === "reg") return o.size;
    if (o.kind === "sreg") return 16;
    if (o.kind === "mem" && o.size) return o.size;
    if (o.kind === "imm") return fallback ?? 16;
    return fallback ?? 16;
  }

  private readOp(o: Operand, size: 8 | 16): number {
    if (o.kind === "reg") return o.size === 8 ? this.getReg8(o.idx) : this.getReg16(o.idx);
    if (o.kind === "sreg") return this.s[o.idx];
    if (o.kind === "imm") return o.value;
    if (o.kind === "label") return o.target;
    const p = this.memAddr(o);
    return size === 8 ? this.rd8(p) : this.rd16(p);
  }
  private writeOp(o: Operand, v: number, size: 8 | 16) {
    if (o.kind === "reg") {
      if (o.size === 8) this.setReg8(o.idx, v);
      else this.setReg16(o.idx, v);
      return;
    }
    if (o.kind === "sreg") {
      this.s[o.idx] = v & 0xffff;
      return;
    }
    if (o.kind === "mem") {
      const p = this.memAddr(o);
      if (size === 8) this.wr8(p, v);
      else this.wr16(p, v);
      return;
    }
    throw new CpuError("cannot write to an immediate value");
  }

  branch(idx: number) {
    this.nextIp = idx;
    this.branched = true;
  }
  push16(v: number) {
    this.r[4] = (this.r[4] - 2) & 0xffff;
    this.wr16(this.phys(this.s[2], this.r[4]), v);
  }
  pop16(): number {
    const v = this.rd16(this.phys(this.s[2], this.r[4]));
    this.r[4] = (this.r[4] + 2) & 0xffff;
    return v;
  }

  /* ---------- main step ---------- */
  step() {
    if (!this.program) throw new CpuError("no program loaded");
    if (this.halted) return;
    if (this.ip < 0 || this.ip >= this.program.instructions.length) {
      this.halted = true;
      this.io.systemMessage("[emu8086] instruction pointer left the program — halted");
      return;
    }
    const ins = this.program.instructions[this.ip];
    this.nextIp = this.ip + 1;
    this.branched = false;
    this.cycles++;
    this.exec(ins);
    this.ip = this.branched ? this.nextIp : this.ip + 1;
  }

  /* ---------- operand size agreement ---------- */
  private opSize(ins: Instruction): 8 | 16 {
    const a = ins.ops[0];
    const b = ins.ops[1];
    if (a?.kind === "reg") return a.size;
    if (b?.kind === "reg") return b.size;
    if (a?.kind === "sreg" || b?.kind === "sreg") return 16;
    if (a?.kind === "mem" && a.size) return a.size;
    if (b?.kind === "mem" && b.size) return b.size;
    throw new CpuError(`line ${ins.line}: operand size is ambiguous — use BYTE PTR or WORD PTR`);
  }

  private requireOps(ins: Instruction, n: number) {
    if (ins.ops.length !== n)
      throw new CpuError(`line ${ins.line}: ${ins.op} expects ${n} operand(s), got ${ins.ops.length}`);
  }

  /* ---------- execution dispatch ---------- */
  private exec(ins: Instruction) {
    const op = ins.op;
    const sz = (): 8 | 16 => this.opSize(ins);

    if (op.startsWith("J") || op === "CALL" || op.startsWith("LOOP")) {
      this.doBranch(ins);
      return;
    }

    switch (op) {
      /* ---- data movement ---- */
      case "MOV": {
        this.requireOps(ins, 2);
        const s = sz();
        const a = ins.ops[0];
        if (a.kind === "imm" || a.kind === "label")
          throw new CpuError(`line ${ins.line}: destination cannot be immediate`);
        if (a.kind === "sreg" && a.idx === 1)
          throw new CpuError(`line ${ins.line}: CS cannot be loaded directly`);
        this.writeOp(a, this.readOp(ins.ops[1], s), s);
        return;
      }
      case "LES":
      case "LDS": {
        this.requireOps(ins, 2);
        const m = ins.ops[1];
        if (m.kind !== "mem") throw new CpuError(`line ${ins.line}: ${op} needs a memory operand`);
        const p = this.memAddr(m);
        this.writeOp(ins.ops[0], this.rd16(p), 16);
        if (op === "LES") this.s[0] = this.rd16(p + 2);
        else this.s[3] = this.rd16(p + 2);
        return;
      }
      case "XCHG": {
        this.requireOps(ins, 2);
        const s = sz();
        const va = this.readOp(ins.ops[0], s);
        const vb = this.readOp(ins.ops[1], s);
        this.writeOp(ins.ops[0], vb, s);
        this.writeOp(ins.ops[1], va, s);
        return;
      }
      case "LEA": {
        this.requireOps(ins, 2);
        const m = ins.ops[1];
        if (m.kind === "mem") this.writeOp(ins.ops[0], this.memOffset(m), 16);
        else if (m.kind === "imm") this.writeOp(ins.ops[0], m.value, 16); // LEA r, LABEL+2
        else throw new CpuError(`line ${ins.line}: LEA needs a memory operand`);
        return;
      }
      case "XLAT": {
        const off = (this.r[3] + (this.r[0] & 0xff)) & 0xffff;
        this.setReg8(0, this.rd8(this.phys(this.s[3], off)));
        return;
      }

      /* ---- stack ---- */
      case "PUSH": {
        this.requireOps(ins, 1);
        const v = this.readOp(ins.ops[0], 16);
        this.push16(v);
        return;
      }
      case "POP": {
        this.requireOps(ins, 1);
        this.writeOp(ins.ops[0], this.pop16(), 16);
        return;
      }
      case "PUSHF":
        this.push16(this.F | 0xf002);
        return;
      case "POPF":
        this.F = (this.pop16() & 0x0fd5) | 2;
        return;
      case "LAHF": {
        const f = this.F & 0xff;
        this.setReg8(4, f);
        return;
      }
      case "SAHF": {
        const ah = this.getReg8(4);
        this.F = (this.F & 0xff00) | (ah & 0xd5) | 2;
        return;
      }

      /* ---- arithmetic ---- */
      case "ADD":
      case "ADC":
      case "SUB":
      case "SBB":
      case "CMP": {
        this.requireOps(ins, 2);
        const s = sz();
        const mask = s === 8 ? 0xff : 0xffff;
        const a = this.readOp(ins.ops[0], s);
        const b = this.readOp(ins.ops[1], s);
        const cin = (op === "ADC" || op === "SBB") && this.flag(F.CF) ? 1 : 0;
        const res =
          op === "ADD" || op === "ADC"
            ? this.setAddFlags(a & mask, b & mask, cin, s)
            : this.setSubFlags(a & mask, b & mask, cin, s);
        if (op !== "CMP") this.writeOp(ins.ops[0], res, s);
        return;
      }
      case "INC":
      case "DEC": {
        this.requireOps(ins, 1);
        const s = sz();
        const cf = this.flag(F.CF);
        const v = this.readOp(ins.ops[0], s);
        const res = op === "INC" ? this.setAddFlags(v, 1, 0, s) : this.setSubFlags(v, 1, 0, s);
        this.setFlag(F.CF, cf);
        this.writeOp(ins.ops[0], res, s);
        return;
      }
      case "NEG": {
        this.requireOps(ins, 1);
        const s = sz();
        const v = this.readOp(ins.ops[0], s);
        const res = this.setSubFlags(0, v, 0, s);
        this.setFlag(F.CF, v !== 0);
        this.writeOp(ins.ops[0], res, s);
        return;
      }
      case "NOT": {
        this.requireOps(ins, 1);
        const s = sz();
        this.writeOp(ins.ops[0], ~this.readOp(ins.ops[0], s), s);
        return;
      }
      case "AND":
      case "OR":
      case "XOR":
      case "TEST": {
        this.requireOps(ins, 2);
        const s = sz();
        const a = this.readOp(ins.ops[0], s);
        const b = this.readOp(ins.ops[1], s);
        const res = this.setLogicFlags(op === "AND" || op === "TEST" ? a & b : op === "OR" ? a | b : a ^ b, s);
        if (op !== "TEST") this.writeOp(ins.ops[0], res, s);
        return;
      }

      /* ---- multiply / divide ---- */
      case "MUL":
      case "IMUL":
      case "DIV":
      case "IDIV": {
        this.requireOps(ins, 1);
        const s = this.sizeOf(ins.ops[0]);
        this.doMulDiv(op, ins.ops[0], s, ins.line);
        return;
      }
      case "CBW": {
        const al = this.getReg8(0);
        this.setReg8(4, al & 0x80 ? 0xff : 0x00);
        return;
      }
      case "CWD": {
        this.r[2] = this.r[0] & 0x8000 ? 0xffff : 0x0000;
        return;
      }

      /* ---- shifts / rotates ---- */
      case "SHL":
      case "SAL":
      case "SHR":
      case "SAR":
      case "ROL":
      case "ROR":
      case "RCL":
      case "RCR": {
        this.requireOps(ins, 2);
        const s = sz();
        const cntOp = ins.ops[1];
        let count: number;
        if (cntOp.kind === "reg") count = this.getReg8(1); // CL
        else count = this.readOp(cntOp, 8);
        this.doShift(op, ins.ops[0], count & 0x1f, s, ins.line);
        return;
      }

      /* ---- misc ---- */
      case "NOP":
        return;
      case "HLT":
        this.halted = true;
        this.io.systemMessage("[emu8086] HLT — processor halted");
        return;
      case "CLC":
        this.setFlag(F.CF, 0);
        return;
      case "STC":
        this.setFlag(F.CF, 1);
        return;
      case "CMC":
        this.setFlag(F.CF, !this.flag(F.CF));
        return;
      case "CLD":
        this.setFlag(F.DF, 0);
        return;
      case "STD":
        this.setFlag(F.DF, 1);
        return;
      case "CLI":
        this.setFlag(F.IF, 0);
        return;
      case "STI":
        this.setFlag(F.IF, 1);
        return;
      case "RET": {
        const target = this.pop16();
        if (ins.ops.length === 1) {
          const extra = this.readOp(ins.ops[0], 16);
          this.r[4] = (this.r[4] + extra) & 0xffff;
        }
        this.branch(target);
        return;
      }
      case "RETF": {
        const target = this.pop16();
        this.pop16(); // discard CS
        this.branch(target);
        return;
      }
      case "IRET": {
        const target = this.pop16();
        this.pop16();
        this.F = (this.pop16() & 0x0fd5) | 2;
        this.branch(target);
        return;
      }
      case "INT": {
        this.requireOps(ins, 1);
        const n = this.readOp(ins.ops[0], 8) & 0xff;
        this.interrupt(n);
        return;
      }

      /* ---- string ops ---- */
      case "MOVSB":
      case "MOVSW":
      case "LODSB":
      case "LODSW":
      case "STOSB":
      case "STOSW":
      case "SCASB":
      case "SCASW":
      case "CMPSB":
      case "CMPSW":
        this.doString(ins);
        return;

      /* ---- BCD adjust ---- */
      case "DAA":
        this.doDAA(ins.line);
        return;
      case "DAS":
        this.doDAS(ins.line);
        return;
      case "AAA": {
        const al = this.getReg8(0);
        if ((al & 0x0f) > 9 || this.flag(F.AF)) {
          this.setReg8(0, (al + 6) & 0xff);
          this.setReg8(4, this.getReg8(4) + 1);
          this.setFlag(F.AF, 1);
          this.setFlag(F.CF, 1);
        } else {
          this.setFlag(F.AF, 0);
          this.setFlag(F.CF, 0);
        }
        this.setReg8(0, this.getReg8(0) & 0x0f);
        return;
      }
      case "AAS": {
        const al = this.getReg8(0);
        if ((al & 0x0f) > 9 || this.flag(F.AF)) {
          this.setReg8(0, (al - 6) & 0xff);
          this.setReg8(4, this.getReg8(4) - 1);
          this.setFlag(F.AF, 1);
          this.setFlag(F.CF, 1);
        } else {
          this.setFlag(F.AF, 0);
          this.setFlag(F.CF, 0);
        }
        this.setReg8(0, this.getReg8(0) & 0x0f);
        return;
      }
      case "AAM": {
        const base = ins.ops.length ? this.readOp(ins.ops[0], 8) : 10;
        if (base === 0) throw new CpuError(`line ${ins.line}: AAM with base 0`);
        const al = this.getReg8(0);
        this.setReg8(4, Math.trunc(al / base));
        this.setReg8(0, al % base);
        this.szp(this.getReg8(0), 8);
        return;
      }
      case "AAD": {
        const base = ins.ops.length ? this.readOp(ins.ops[0], 8) : 10;
        const r = (this.getReg8(4) * base + this.getReg8(0)) & 0xff;
        this.setReg8(0, r);
        this.setReg8(4, 0);
        this.szp(r, 8);
        return;
      }

      case "IN": {
        this.requireOps(ins, 2);
        this.systemUnsupported(`IN from port ${this.readOp(ins.ops[1], 16)}`);
        this.writeOp(ins.ops[0], 0xff, sz());
        return;
      }
      case "OUT": {
        this.requireOps(ins, 2);
        this.systemUnsupported(`OUT to port ${this.readOp(ins.ops[0], 16)} — ignored`);
        return;
      }
    }
    throw new CpuError(`line ${ins.line}: '${op}' is not implemented by this emulator`);
  }

  private systemUnsupported(msg: string) {
    this.io.systemMessage(`[emu8086] ${msg} is not supported by the emulator`);
  }

  /* ---------- branches ---------- */
  private doBranch(ins: Instruction) {
    const op = ins.op;
    const t = ins.ops[0];
    const take = (): boolean => {
      switch (op) {
        case "JMP": return true;
        case "JA": case "JNBE": return !this.flag(F.CF) && !this.flag(F.ZF);
        case "JAE": case "JNB": case "JNC": return !this.flag(F.CF);
        case "JB": case "JNAE": case "JC": return !!this.flag(F.CF);
        case "JBE": case "JNA": return !!(this.flag(F.CF) || this.flag(F.ZF));
        case "JE": case "JZ": return !!this.flag(F.ZF);
        case "JNE": case "JNZ": return !this.flag(F.ZF);
        case "JG": case "JNLE": return !this.flag(F.ZF) && this.flag(F.SF) === this.flag(F.OF);
        case "JGE": case "JNL": return this.flag(F.SF) === this.flag(F.OF);
        case "JL": case "JNGE": return this.flag(F.SF) !== this.flag(F.OF);
        case "JLE": case "JNG": return !!(this.flag(F.ZF) || this.flag(F.SF) !== this.flag(F.OF));
        case "JO": return !!this.flag(F.OF);
        case "JNO": return !this.flag(F.OF);
        case "JS": return !!this.flag(F.SF);
        case "JNS": return !this.flag(F.SF);
        case "JP": case "JPE": return !!this.flag(F.PF);
        case "JNP": case "JPO": return !this.flag(F.PF);
        default: return false;
      }
    };

    if (op === "CALL") {
      if (!t || t.kind !== "label" || t.target < 0) throw new CpuError(`line ${ins.line}: CALL target must be a label`);
      this.push16(this.ip + 1);
      this.branch(t.target);
      return;
    }
    if (op === "LOOP" || op === "LOOPE" || op === "LOOPZ" || op === "LOOPNE" || op === "LOOPNZ") {
      this.r[1] = (this.r[1] - 1) & 0xffff;
      if (!t || t.kind !== "label") throw new CpuError(`line ${ins.line}: ${op} target must be a label`);
      let ok = this.r[1] !== 0;
      if (op === "LOOPE" || op === "LOOPZ") ok = ok && !!this.flag(F.ZF);
      if (op === "LOOPNE" || op === "LOOPNZ") ok = ok && !this.flag(F.ZF);
      if (ok) this.branch(t.target);
      return;
    }
    if (op === "JCXZ") {
      if (!t || t.kind !== "label") throw new CpuError(`line ${ins.line}: JCXZ target must be a label`);
      if (this.r[1] === 0) this.branch(t.target);
      return;
    }
    if (!t || t.kind !== "label" || t.target < 0) throw new CpuError(`line ${ins.line}: ${op} target must be a label`);
    if (take()) this.branch(t.target);
  }

  /* ---------- mul/div ---------- */
  private sx8(v: number): number {
    return v & 0x80 ? v - 0x100 : v;
  }
  private sx16(v: number): number {
    return v & 0x8000 ? v - 0x10000 : v;
  }

  private doMulDiv(op: string, src: Operand, s: 8 | 16, line: number) {
    const v = this.readOp(src, s);
    if (op === "MUL") {
      if (s === 8) {
        const res = (this.getReg8(0) * (v & 0xff)) & 0xffff;
        this.r[0] = res;
        const high = res >> 8;
        this.setFlag(F.CF, high !== 0);
        this.setFlag(F.OF, high !== 0);
      } else {
        const res = this.r[0] * (v & 0xffff);
        this.r[0] = res & 0xffff;
        this.r[2] = Math.floor(res / 0x10000) & 0xffff;
        this.setFlag(F.CF, this.r[2] !== 0);
        this.setFlag(F.OF, this.r[2] !== 0);
      }
      return;
    }
    if (op === "IMUL") {
      if (s === 8) {
        const res = Math.trunc(this.sx8(this.getReg8(0)) * this.sx8(v & 0xff));
        this.r[0] = res & 0xffff;
        const fits = res >= -128 && res <= 127;
        this.setFlag(F.CF, !fits);
        this.setFlag(F.OF, !fits);
      } else {
        const res = Math.trunc(this.sx16(this.r[0]) * this.sx16(v & 0xffff));
        this.r[0] = res & 0xffff;
        this.r[2] = Math.floor(res / 0x10000) & 0xffff;
        const fits = res >= -32768 && res <= 32767;
        this.setFlag(F.CF, !fits);
        this.setFlag(F.OF, !fits);
      }
      return;
    }
    if (v === 0) throw new CpuError(`line ${line}: divide error — division by zero`);
    if (op === "DIV") {
      if (s === 8) {
        const q = Math.floor(this.r[0] / (v & 0xff));
        if (q > 0xff) throw new CpuError(`line ${line}: divide overflow (quotient too large)`);
        this.setReg8(0, q);
        this.setReg8(4, this.r[0] % (v & 0xff));
      } else {
        const dividend = this.r[2] * 0x10000 + this.r[0];
        const q = Math.floor(dividend / (v & 0xffff));
        if (q > 0xffff) throw new CpuError(`line ${line}: divide overflow (quotient too large)`);
        this.r[0] = q & 0xffff;
        this.r[2] = dividend % (v & 0xffff);
      }
      return;
    }
    // IDIV
    if (s === 8) {
      const dividend = this.sx16(this.r[0]);
      const q = Math.trunc(dividend / this.sx8(v & 0xff));
      if (q > 127 || q < -128) throw new CpuError(`line ${line}: divide overflow (quotient too large)`);
      this.setReg8(0, q < 0 ? q + 0x100 : q);
      const rem = dividend % this.sx8(v & 0xff);
      this.setReg8(4, rem < 0 ? rem + 0x100 : rem);
    } else {
      const dividend = this.sx16(this.r[2]) * 0x10000 + this.r[0];
      const q = Math.trunc(dividend / this.sx16(v & 0xffff));
      if (q > 32767 || q < -32768) throw new CpuError(`line ${line}: divide overflow (quotient too large)`);
      this.r[0] = q & 0xffff;
      const rem = dividend % this.sx16(v & 0xffff);
      this.r[2] = rem & 0xffff;
    }
  }

  /* ---------- shifts ---------- */
  private doShift(op: string, dst: Operand, count: number, s: 8 | 16, line: number) {
    if (count === 0) return;
    if (count > 31) throw new CpuError(`line ${line}: shift count too large`);
    const mask = s === 8 ? 0xff : 0xffff;
    const msb = s === 8 ? 0x80 : 0x8000;
    let v = this.readOp(dst, s) & mask;
    let cf = this.flag(F.CF);

    for (let i = 0; i < count; i++) {
      if (op === "SHL" || op === "SAL") {
        cf = (v & msb) !== 0 ? 1 : 0;
        v = (v << 1) & mask;
      } else if (op === "SHR") {
        cf = v & 1;
        v = (v >> 1) & mask;
      } else if (op === "SAR") {
        cf = v & 1;
        v = (v >> 1) | (v & msb);
      } else if (op === "ROL") {
        cf = (v & msb) !== 0 ? 1 : 0;
        v = ((v << 1) | cf) & mask;
      } else if (op === "ROR") {
        cf = v & 1;
        v = (v >> 1) | (cf ? msb : 0);
      } else if (op === "RCL") {
        const ncf = (v & msb) !== 0 ? 1 : 0;
        v = ((v << 1) | cf) & mask;
        cf = ncf;
      } else if (op === "RCR") {
        const ncf = v & 1;
        v = (v >> 1) | (cf ? msb : 0);
        cf = ncf;
      }
    }
    this.setFlag(F.CF, cf);
    if (count === 1) {
      if (op === "SHL" || op === "SAL") this.setFlag(F.OF, (((v & msb) !== 0 ? 1 : 0) ^ cf) !== 0);
      else if (op === "SHR") this.setFlag(F.OF, (v & msb) !== 0);
      else if (op === "SAR") this.setFlag(F.OF, 0);
      else if (op === "ROL") this.setFlag(F.OF, (((v & msb) !== 0 ? 1 : 0) ^ cf) !== 0);
      else if (op === "ROR") this.setFlag(F.OF, (((v & msb) >> (s === 8 ? 7 : 15)) ^ ((v & (msb >> 1)) !== 0 ? 1 : 0)) !== 0);
    }
    if (op === "SHL" || op === "SAL" || op === "SHR" || op === "SAR") this.szp(v, s);
    this.writeOp(dst, v, s);
  }

  /* ---------- BCD ---------- */
  private doDAA(line: number) {
    void line;
    const oldAl = this.getReg8(0);
    const oldCf = this.flag(F.CF);
    let al = oldAl;
    this.setFlag(F.CF, 0);
    if ((al & 0x0f) > 9 || this.flag(F.AF)) {
      al = (al + 6) & 0xff;
      this.setFlag(F.AF, 1);
      this.setFlag(F.CF, oldCf || oldAl + 6 > 0xff);
    } else this.setFlag(F.AF, 0);
    if (oldAl > 0x99 || oldCf) {
      al = (al + 0x60) & 0xff;
      this.setFlag(F.CF, 1);
    }
    this.setReg8(0, al);
    this.szp(al, 8);
  }
  private doDAS(line: number) {
    void line;
    const oldAl = this.getReg8(0);
    const oldCf = this.flag(F.CF);
    let al = oldAl;
    this.setFlag(F.CF, 0);
    if ((al & 0x0f) > 9 || this.flag(F.AF)) {
      al = (al - 6) & 0xff;
      this.setFlag(F.AF, 1);
      this.setFlag(F.CF, oldCf || oldAl < 6);
    } else this.setFlag(F.AF, 0);
    if (oldAl > 0x99 || oldCf) {
      al = (al - 0x60) & 0xff;
      this.setFlag(F.CF, 1);
    }
    this.setReg8(0, al);
    this.szp(al, 8);
  }

  /* ---------- string ops ---------- */
  private doString(ins: Instruction) {
    const op = ins.op;
    const s: 8 | 16 = op.endsWith("B") ? 8 : 16;
    const delta = (this.flag(F.DF) ? -1 : 1) * (s === 8 ? 1 : 2);

    const once = (): void => {
      const srcP = this.phys(this.s[3], this.r[6]);
      const dstP = this.phys(this.s[0], this.r[7]);
      if (op.startsWith("MOVS")) {
        const v = s === 8 ? this.rd8(srcP) : this.rd16(srcP);
        if (s === 8) this.wr8(dstP, v);
        else this.wr16(dstP, v);
        this.r[6] = (this.r[6] + delta) & 0xffff;
        this.r[7] = (this.r[7] + delta) & 0xffff;
      } else if (op.startsWith("LODS")) {
        const v = s === 8 ? this.rd8(srcP) : this.rd16(srcP);
        if (s === 8) this.setReg8(0, v);
        else this.r[0] = v;
        this.r[6] = (this.r[6] + delta) & 0xffff;
      } else if (op.startsWith("STOS")) {
        const v = s === 8 ? this.getReg8(0) : this.r[0];
        if (s === 8) this.wr8(dstP, v);
        else this.wr16(dstP, v);
        this.r[7] = (this.r[7] + delta) & 0xffff;
      } else if (op.startsWith("SCAS")) {
        const a = s === 8 ? this.getReg8(0) : this.r[0];
        const b = s === 8 ? this.rd8(dstP) : this.rd16(dstP);
        this.setSubFlags(a, b, 0, s);
        this.r[7] = (this.r[7] + delta) & 0xffff;
      } else if (op.startsWith("CMPS")) {
        const a = s === 8 ? this.rd8(srcP) : this.rd16(srcP);
        const b = s === 8 ? this.rd8(dstP) : this.rd16(dstP);
        this.setSubFlags(a, b, 0, s);
        this.r[6] = (this.r[6] + delta) & 0xffff;
        this.r[7] = (this.r[7] + delta) & 0xffff;
      }
    };

    const isCmp = op.startsWith("SCAS") || op.startsWith("CMPS");
    if (ins.rep) {
      let guard = 0x20000;
      while (this.r[1] !== 0) {
        once();
        this.r[1] = (this.r[1] - 1) & 0xffff;
        if (isCmp && ins.rep === "REPE" && !this.flag(F.ZF)) break;
        if (isCmp && ins.rep === "REPNE" && this.flag(F.ZF)) break;
        if (--guard <= 0) throw new CpuError(`line ${ins.line}: REP iteration limit exceeded`);
      }
    } else once();
  }

  /* ---------- interrupts ---------- */
  private interrupt(n: number) {
    if (n === 0x21) {
      this.dos();
      return;
    }
    if (n === 0x20) {
      this.halted = true;
      this.io.systemMessage("[emu8086] INT 20h — program terminated");
      return;
    }
    if (n === 0x10) {
      this.video();
      return;
    }
    if (n === 0x16) {
      this.keyboard();
      return;
    }
    if (n === 0x03) {
      this.io.systemMessage(`[emu8086] breakpoint (INT 3) at CS:${(this.ip + EMU.CODE_BASE).toString(16).toUpperCase()}`);
      return;
    }
    this.io.systemMessage(`[emu8086] INT ${hex2(n)}h is not emulated — ignored`);
  }

  private dos() {
    const ah = this.getReg8(4);
    switch (ah) {
      case 0x01: {
        // char input with echo
        if (this.io.inputAvailable()) {
          const c = this.io.readChar();
          this.setReg8(0, c);
          this.io.writeChar(c);
        } else throw new NeedInput("char", true);
        return;
      }
      case 0x02:
        this.io.writeChar(this.getReg8(2));
        return;
      case 0x06: {
        const dl = this.getReg8(2);
        if (dl === 0xff) {
          if (this.io.inputAvailable()) {
            this.setReg8(0, this.io.readChar());
            this.setFlag(F.ZF, 0);
          } else {
            this.setReg8(0, 0);
            this.setFlag(F.ZF, 1);
          }
        } else {
          this.io.writeChar(dl);
        }
        return;
      }
      case 0x08: {
        if (this.io.inputAvailable()) {
          this.setReg8(0, this.io.readChar());
        } else throw new NeedInput("char", false);
        return;
      }
      case 0x09: {
        // $-terminated string at DS:DX
        let p = this.phys(this.s[3], this.r[2]);
        let out = "";
        let guard = 0;
        for (;;) {
          const c = this.rd8(p);
          if (c === 0x24) break; // '$'
          out += String.fromCharCode(c);
          p = (p + 1) & 0xfffff;
          if (++guard > 0x8000) {
            this.io.systemMessage("[emu8086] AH=09h: string not terminated with '$' — stopped early");
            break;
          }
        }
        this.io.writeString(out);
        return;
      }
      case 0x0a: {
        // buffered input at DS:DX : [max][count][chars...]
        if (this.lineReady) {
          this.lineReady = false; // machine already filled the buffer
          return;
        }
        const p = this.phys(this.s[3], this.r[2]);
        throw new NeedInput("line", true, p, this.rd8(p));
      }
      case 0x0b:
        this.setReg8(0, this.io.inputAvailable() ? 0xff : 0x00);
        return;
      case 0x0c: {
        this.io.clearInput();
        const sub = this.getReg8(0); // AL
        if (sub === 0x01 || sub === 0x08) {
          if (this.io.inputAvailable()) {
            const c = this.io.readChar();
            this.setReg8(0, c);
            if (sub === 0x01) this.io.writeChar(c);
          } else throw new NeedInput("char", sub === 0x01);
        }
        return;
      }
      case 0x25: {
        // set interrupt vector DS:DX for INT AL
        const v = this.getReg8(0) * 4;
        this.wr16(v, this.r[2]);
        this.wr16(v + 2, this.s[3]);
        return;
      }
      case 0x35: {
        const v = this.getReg8(0) * 4;
        this.s[0] = this.rd16(v + 2);
        this.r[3] = this.rd16(v);
        return;
      }
      case 0x2a: {
        const d = new Date();
        this.r[1] = d.getFullYear();
        this.setReg8(6, d.getMonth() + 1); // DH
        this.setReg8(2, d.getDate()); // DL
        this.setReg8(0, d.getDay()); // AL
        return;
      }
      case 0x2c: {
        const d = new Date();
        this.setReg8(5, d.getHours()); // CH
        this.setReg8(1, d.getMinutes()); // CL
        this.setReg8(6, d.getSeconds()); // DH
        this.setReg8(2, Math.trunc(d.getMilliseconds() / 10)); // DL
        return;
      }
      case 0x30:
        this.setReg8(0, 5);
        this.setReg8(3, 0);
        return;
      case 0x4c:
        this.halted = true;
        this.io.systemMessage(
          `[emu8086] program exited — return code ${this.getReg8(0)} (${this.cycles.toLocaleString()} instructions)`
        );
        return;
      default:
        this.io.systemMessage(`[emu8086] DOS function AH=${hex2(ah)}h is not supported — ignored`);
    }
  }

  private video() {
    const ah = this.getReg8(4);
    switch (ah) {
      case 0x00:
        this.io.clearScreen();
        return;
      case 0x02:
        this.io.setCursor(this.getReg8(6), this.getReg8(2)); // DH row, DL col
        return;
      case 0x03: {
        const c = this.io.getCursor();
        this.setReg8(6, c.row);
        this.setReg8(2, c.col);
        this.r[1] = 0x0607;
        return;
      }
      case 0x06:
      case 0x07:
        if (this.getReg8(0) === 0) this.io.clearScreen();
        return;
      case 0x0e:
        this.io.writeChar(this.getReg8(0));
        return;
      case 0x0a:
        this.io.writeChar(this.getReg8(0));
        return;
      default:
        this.io.systemMessage(`[emu8086] BIOS video function AH=${hex2(ah)}h is not supported — ignored`);
    }
  }

  private keyboard() {
    const ah = this.getReg8(4);
    switch (ah) {
      case 0x00: {
        if (this.io.inputAvailable()) {
          this.setReg8(0, this.io.readChar());
          this.setReg8(4, 0);
        } else throw new NeedInput("char", false);
        return;
      }
      case 0x01: {
        if (this.io.inputAvailable()) {
          this.setReg8(0, this.io.peekChar());
          this.setReg8(4, 0);
          this.setFlag(F.ZF, 0);
        } else {
          this.setFlag(F.ZF, 1);
        }
        return;
      }
      default:
        this.io.systemMessage(`[emu8086] BIOS keyboard function AH=${hex2(ah)}h is not supported — ignored`);
    }
  }
}
