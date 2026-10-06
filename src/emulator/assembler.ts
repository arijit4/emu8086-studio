/* ------------------------------------------------------------------
 * emu8086-style assembler (MASM subset)
 * Supports: .MODEL .STACK .DATA .CODE, DB/DW/DD, DUP, EQU, ORG,
 * PROC/ENDP/END, labels, char/string literals, expressions,
 * register/immediate/memory/label operands, PTR and segment override.
 * ------------------------------------------------------------------ */

export interface AsmError {
  line: number;
  message: string;
}

export interface DataLabel {
  offset: number;
  size: number; // bytes reserved
  type: "DB" | "DW" | "DD";
}

export type Operand =
  | { kind: "reg"; idx: number; size: 8 | 16 }
  | { kind: "sreg"; idx: number }
  | { kind: "imm"; value: number }
  | {
      kind: "mem";
      base: number | null; // reg idx (BX=3, BP=5) or null
      index: number | null; // reg idx (SI=6, DI=7) or null
      disp: number;
      size: 8 | 16 | null;
      seg: number | null; // segment override idx (ES=0 CS=1 SS=2 DS=3)
      name?: string;
    }
  | { kind: "label"; name: string; target: number };

export interface Instruction {
  op: string;
  rep: "REP" | "REPE" | "REPNE" | null;
  ops: Operand[];
  line: number; // 1-based source line
  addr: number; // pseudo offset within CS
  size: number; // pseudo byte length
  raw: string;
}

export interface Program {
  ok: boolean;
  errors: AsmError[];
  instructions: Instruction[];
  data: number[]; // bytes to load at DS:0000
  dataLabels: Map<string, DataLabel>;
  codeLabels: Map<string, number>;
  labelList: Array<{ name: string; offset: number }>;
  stackSize: number;
  entryIndex: number;
  codeBytes: number;
}

/* register encodings (8086 order) */
export const REG16: Record<string, number> = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
export const REG8: Record<string, number> = { AL: 0, CL: 1, DL: 2, BL: 3, AH: 4, CH: 5, DH: 6, BH: 7 };
export const SEGIDX: Record<string, number> = { ES: 0, CS: 1, SS: 2, DS: 3 };

export const MNEMONICS = new Set([
  "MOV", "XCHG", "LEA", "LDS", "LES", "XLAT", "PUSH", "POP", "PUSHF", "POPF", "LAHF", "SAHF",
  "ADD", "ADC", "SUB", "SBB", "INC", "DEC", "NEG", "NOT", "CMP", "TEST",
  "AND", "OR", "XOR", "MUL", "IMUL", "DIV", "IDIV", "CBW", "CWD",
  "SHL", "SAL", "SHR", "SAR", "ROL", "ROR", "RCL", "RCR",
  "JMP", "CALL", "RET", "RETF", "LOOP", "LOOPE", "LOOPZ", "LOOPNE", "LOOPNZ", "JCXZ",
  "JA", "JAE", "JB", "JBE", "JC", "JE", "JZ", "JG", "JGE", "JL", "JLE", "JNA",
  "JNAE", "JNB", "JNBE", "JNC", "JNE", "JNG", "JNGE", "JNL", "JNLE", "JNO", "JNP",
  "JNS", "JNZ", "JO", "JP", "JPE", "JPO", "JS",
  "INT", "IRET", "CLC", "STC", "CMC", "CLD", "STD", "CLI", "STI", "NOP", "HLT",
  "MOVSB", "MOVSW", "LODSB", "LODSW", "STOSB", "STOSW", "SCASB", "SCASW", "CMPSB", "CMPSW",
  "REP", "REPE", "REPZ", "REPNE", "REPNZ",
  "AAA", "AAS", "AAM", "AAD", "DAA", "DAS", "IN", "OUT",
]);

const BRANCHES = new Set([
  "JMP", "CALL", "LOOP", "LOOPE", "LOOPZ", "LOOPNE", "LOOPNZ", "JCXZ",
  "JA", "JAE", "JB", "JBE", "JC", "JE", "JZ", "JG", "JGE", "JL", "JLE", "JNA",
  "JNAE", "JNB", "JNBE", "JNC", "JNE", "JNG", "JNGE", "JNL", "JNLE", "JNO", "JNP",
  "JNS", "JNZ", "JO", "JP", "JPE", "JPO", "JS",
]);

const CODE_BASE = 0x0100;
const DATA_SEG_VALUE = 0x0800;

/* ---------- text helpers ---------- */

function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) {
        if (line[i + 1] === q) i++; // '' escape
        else q = null;
      }
    } else if (c === "'" || c === '"') q = c;
    else if (c === ";") return line.slice(0, i);
  }
  return line;
}

function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
    } else if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if (c === "[" || c === "(") {
      depth++;
      cur += c;
    } else if (c === "]" || c === ")") {
      depth--;
      cur += c;
    } else if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/* parse a numeric / char literal, returns null on failure */
export function parseLiteral(tok: string): number | null {
  const t = tok.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^'(.*)'$/) ?? t.match(/^"(.*)"$/))) {
    const body = m[1].replace(/''/g, "'").replace(/""/g, '"');
    if (body.length === 1) return body.charCodeAt(0);
    return null;
  }
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?[0-9][0-9A-Fa-f]*[Hh]$/.test(t)) {
    const neg = t.startsWith("-");
    const v = parseInt(t.replace(/[Hh]$/, ""), 16);
    return neg ? -v : v;
  }
  if (/^[01]+[Bb]$/.test(t)) return parseInt(t.slice(0, -1), 2);
  if (/^[0-7]+[QqOo]$/.test(t)) return parseInt(t.slice(0, -1), 8);
  return null;
}

/* ---------- expression evaluator ---------- */

interface ExprCtx {
  consts: Map<string, number>;
  dataLabels: Map<string, DataLabel>;
  resolveIdent?: (name: string) => number | null;
}

function evalExpr(src: string, ctx: ExprCtx, line: number): number {
  let pos = 0;
  const s = src;

  function skip() {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  }
  function peek(): string {
    skip();
    return pos < s.length ? s[pos] : "";
  }
  function parsePrimary(): number {
    skip();
    if (s[pos] === "(") {
      pos++;
      const v = parseExpr();
      skip();
      if (s[pos] !== ")") throw new Error(`line ${line}: missing ')' in expression '${src}'`);
      pos++;
      return v;
    }
    if (s[pos] === "-") {
      pos++;
      return -parsePrimary();
    }
    if (s[pos] === "+") {
      pos++;
      return parsePrimary();
    }
    // quoted char
    if (s[pos] === "'" || s[pos] === '"') {
      const qc = s[pos];
      const end = s.indexOf(qc, pos + 1);
      if (end < 0) throw new Error(`line ${line}: unterminated literal in '${src}'`);
      const body = s.slice(pos + 1, end);
      pos = end + 1;
      if (body.length !== 1) throw new Error(`line ${line}: '${body}' is not a single character`);
      return body.charCodeAt(0);
    }
    // numeric / identifier token
    const m = s.slice(pos).match(/^[A-Za-z_.$@?0-9][\w.$@?]*/);
    if (!m) throw new Error(`line ${line}: unexpected '${s.slice(pos)}' in expression`);
    const tok = m[0];
    pos += tok.length;
    const lit = parseLiteral(tok);
    if (lit !== null) return lit;
    const up = tok.toUpperCase();
    if (up === "@DATA") return DATA_SEG_VALUE;
    const low = tok.toLowerCase();
    if (ctx.consts.has(low)) return ctx.consts.get(low)!;
    if (ctx.dataLabels.has(low)) return ctx.dataLabels.get(low)!.offset;
    if (ctx.resolveIdent) {
      const v = ctx.resolveIdent(low);
      if (v !== null) return v;
    }
    // helpful hint for hex without trailing H
    if (/^[0-9][0-9A-Fa-f]*[A-Fa-f]$/.test(tok))
      throw new Error(`line ${line}: '${tok}' looks like hex — hex literals end with H (e.g. ${tok.toUpperCase()}H)`);
    throw new Error(`line ${line}: unknown symbol '${tok}'`);
  }
  function parseTerm(): number {
    let v = parsePrimary();
    for (;;) {
      const c = peek();
      if (c === "*") {
        pos++;
        v *= parsePrimary();
      } else if (c === "/") {
        pos++;
        const d = parsePrimary();
        if (d === 0) throw new Error(`line ${line}: division by zero in expression`);
        v = Math.trunc(v / d);
      } else return v;
    }
  }
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      const c = peek();
      if (c === "+") {
        pos++;
        v += parseTerm();
      } else if (c === "-") {
        pos++;
        v -= parseTerm();
      } else return v;
    }
  }
  const result = parseExpr();
  skip();
  if (pos < s.length) throw new Error(`line ${line}: trailing characters in expression '${src}'`);
  return result;
}

/* ---------- operand parsing ---------- */

function parseMemOperand(
  content: string,
  name: string | null,
  size: 8 | 16 | null,
  seg: number | null,
  ctx: ExprCtx,
  line: number
): Operand {
  let base: number | null = null;
  let index: number | null = null;
  let disp = 0;
  let labName: string | undefined;

  if (name) {
    const d = ctx.dataLabels.get(name.toLowerCase());
    if (!d) throw new Error(`line ${line}: unknown data label '${name}'`);
    disp += d.offset;
    labName = name.toUpperCase();
    if (size === null) size = d.type === "DB" ? 8 : 16;
  }

  const inner = content.replace(/\s+/g, "");
  if (inner) {
    const terms = inner.replace(/-/g, "+-").split("+").filter((t) => t !== "");
    for (const term of terms) {
      const up = term.replace(/^-/, "").toUpperCase();
      const neg = term.startsWith("-");
      if (up === "BX" || up === "BP") {
        if (neg) throw new Error(`line ${line}: cannot negate register ${up}`);
        if (base !== null) throw new Error(`line ${line}: two base registers in [${content}]`);
        base = up === "BX" ? 3 : 5;
      } else if (up === "SI" || up === "DI") {
        if (neg) throw new Error(`line ${line}: cannot negate register ${up}`);
        if (index !== null) throw new Error(`line ${line}: two index registers in [${content}]`);
        index = up === "SI" ? 6 : 7;
      } else if (up in REG16 || up in REG8) {
        throw new Error(`line ${line}: register ${up} cannot be used in an address (use BX/BP/SI/DI)`);
      } else {
        const v = evalExpr(term, ctx, line);
        disp += v;
      }
    }
  }

  return { kind: "mem", base, index, disp: disp & 0xffff, size, seg, name: labName };
}

function parseOperand(rawIn: string, ctx: ExprCtx, line: number): Operand {
  let raw = rawIn.trim();
  if (!raw) throw new Error(`line ${line}: empty operand`);

  let size: 8 | 16 | null = null;
  let seg: number | null = null;

  // strip prefixes (can nest: BYTE PTR DS:[BX])
  for (;;) {
    let m = raw.match(/^(BYTE|WORD)\s+PTR\s+(.+)$/i);
    if (m) {
      size = m[1].toUpperCase() === "BYTE" ? 8 : 16;
      raw = m[2].trim();
      continue;
    }
    m = raw.match(/^DWORD\s+PTR\s+(.+)$/i);
    if (m) {
      raw = m[1].trim();
      continue;
    }
    m = raw.match(/^(ES|CS|SS|DS)\s*:\s*(.+)$/i);
    if (m) {
      seg = SEGIDX[m[1].toUpperCase()];
      raw = m[2].trim();
      continue;
    }
    m = raw.match(/^(?:NEAR|FAR|SHORT)(?:\s+PTR)?\s+(.+)$/i);
    if (m) {
      raw = m[1].trim();
      continue;
    }
    break;
  }

  let m = raw.match(/^OFFSET\s+(.+)$/i);
  if (m) {
    const v = evalExpr(m[1], ctx, line);
    return { kind: "imm", value: v & 0xffff };
  }

  const up = raw.toUpperCase();
  if (up in REG16) {
    if (seg !== null) throw new Error(`line ${line}: segment override on register '${raw}'`);
    if (size !== null) throw new Error(`line ${line}: PTR on register '${raw}'`);
    return { kind: "reg", idx: REG16[up], size: 16 };
  }
  if (up in REG8) {
    if (seg !== null) throw new Error(`line ${line}: segment override on register '${raw}'`);
    if (size !== null) throw new Error(`line ${line}: PTR on register '${raw}'`);
    return { kind: "reg", idx: REG8[up], size: 8 };
  }
  if (up in SEGIDX) {
    if (seg !== null) throw new Error(`line ${line}: segment override on segment register '${raw}'`);
    return { kind: "sreg", idx: SEGIDX[up] };
  }

  // [expr]  or  NAME[expr]
  m = raw.match(/^([A-Za-z_.$?][\w.$?]*)?\s*\[(.*)\]$/);
  if (m) {
    const inner = m[2];
    if (/\[|\]/.test(inner)) throw new Error(`line ${line}: nested brackets in '${raw}'`);
    return parseMemOperand(inner, m[1] ?? null, size, seg, ctx, line);
  }

  // bare data label => memory direct
  const low = raw.toLowerCase();
  if (ctx.dataLabels.has(low)) {
    const d = ctx.dataLabels.get(low)!;
    return {
      kind: "mem",
      base: null,
      index: null,
      disp: d.offset,
      size: size ?? (d.type === "DB" ? 8 : 16),
      seg,
      name: up,
    };
  }

  // immediate expression
  try {
    const v = evalExpr(raw, ctx, line);
    if (seg !== null) throw new Error(`line ${line}: segment override on immediate`);
    return { kind: "imm", value: v };
  } catch (e) {
    // may be a code label (forward reference) -> resolved in pass 2
    if (/^[A-Za-z_.$?][\w.$?]*$/.test(raw)) return { kind: "label", name: up, target: -1 };
    throw e;
  }
}

/* ---------- data section ---------- */

function parseDataValues(
  rest: string,
  type: "DB" | "DW" | "DD",
  ctx: ExprCtx,
  data: number[],
  line: number
): void {
  const unit = type === "DB" ? 1 : type === "DW" ? 2 : 4;
  const parts = splitTop(rest);
  if (parts.length === 1 && parts[0] === "") throw new Error(`line ${line}: ${type} needs at least one value`);

  const emitOne = (p: string) => {
    if (p === "?" || p === "") {
      for (let i = 0; i < unit; i++) data.push(0);
      return;
    }
    const dup = p.match(/^(.+?)\s+DUP\s*\((.*)\)$/i);
    if (dup) {
      const count = evalExpr(dup[1], ctx, line);
      if (count < 0 || count > 8192) throw new Error(`line ${line}: invalid DUP count ${count}`);
      const inner = splitTop(dup[2]);
      for (let n = 0; n < count; n++) inner.forEach(emitOne);
      return;
    }
    const str = p.match(/^'((?:[^']|'')*)'$/) ?? p.match(/^"((?:[^"]|"")*)"$/);
    if (str) {
      const body = str[1].replace(/''/g, "'").replace(/""/g, '"');
      if (unit === 1) {
        for (const ch of body) data.push(ch.charCodeAt(0));
      } else {
        // MASM packs strings little-endian in words
        for (let i = 0; i < body.length; i++) data.push(body.charCodeAt(i));
        while (data.length % unit !== 0) data.push(0);
      }
      return;
    }
    const v = evalExpr(p, ctx, line);
    const mask = unit === 1 ? 0xff : unit === 2 ? 0xffff : 0xffffffff;
    const clamped = v & mask;
    for (let i = 0; i < unit; i++) data.push((clamped >>> (i * 8)) & 0xff);
  };

  parts.forEach(emitOne);
}

/* ---------- main entry ---------- */

export function assemble(source: string): Program {
  const errors: AsmError[] = [];
  const instructions: Instruction[] = [];
  const data: number[] = [];
  const dataLabels = new Map<string, DataLabel>();
  const codeLabels = new Map<string, number>();
  const consts = new Map<string, number>();
  let stackSize = 0x0100;
  let section: "none" | "data" | "code" = "none";
  let ended = false;

  const ctx: ExprCtx = { consts, dataLabels };
  const err = (line: number, message: string) => errors.push({ line, message });

  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    if (ended) break;
    let text = stripComment(rawLines[i]).trim();
    if (!text) continue;

    try {
      // dot directives
      if (text.startsWith(".")) {
        const m = text.match(/^\.(\w+)(?:\s+(.*))?$/);
        if (!m) continue;
        const dir = m[1].toUpperCase();
        const arg = (m[2] ?? "").trim();
        if (dir === "MODEL") {
          // .MODEL SMALL etc — accepted, only SMALL/TINY meaningful here
        } else if (dir === "STACK") {
          if (arg) {
            const v = parseLiteral(arg) ?? evalExpr(arg, ctx, lineNo);
            if (v <= 0 || v > 0xff00) err(lineNo, `invalid stack size '${arg}'`);
            else stackSize = v & ~1;
          }
        } else if (dir === "DATA" || dir === "DATA?" || dir === "CONST" || dir === "FARDATA") {
          section = "data";
        } else if (dir === "CODE") {
          section = "code";
        } else if (
          ["LIST", "NOLIST", "RADIX", "8086", "186", "286", "386", "486", "STARTUP", "EXIT"].includes(dir)
        ) {
          // tolerated, no-op
        } else {
          err(lineNo, `unsupported directive '.${m[1]}'`);
        }
        continue;
      }

      // label with colon
      const lm = text.match(/^([A-Za-z_.$?][\w.$?]*)\s*:\s*(.*)$/);
      if (lm) {
        const name = lm[1].toLowerCase();
        if (codeLabels.has(name) || dataLabels.has(name)) err(lineNo, `duplicate label '${lm[1]}'`);
        else if (section === "code") codeLabels.set(name, instructions.length);
        else err(lineNo, `label '${lm[1]}' outside .CODE section`);
        text = lm[2].trim();
        if (!text) continue;
      }

      // EQU / =
      let m = text.match(/^([A-Za-z_.$?][\w.$?]*)\s+EQU\s+(.+)$/i);
      if (m) {
        const name = m[1].toLowerCase();
        if (consts.has(name)) err(lineNo, `duplicate constant '${m[1]}'`);
        else consts.set(name, evalExpr(m[2], ctx, lineNo));
        continue;
      }
      m = text.match(/^([A-Za-z_.$?][\w.$?]*)\s*=\s*([^=].*)$/);
      if (m) {
        const name = m[1].toLowerCase();
        consts.set(name, evalExpr(m[2], ctx, lineNo));
        continue;
      }

      // PROC / ENDP
      m = text.match(/^([A-Za-z_.$?][\w.$?]*)\s+PROC\b(?:\s+(?:NEAR|FAR))?$/i);
      if (m) {
        if (section !== "code") err(lineNo, `PROC outside .CODE section`);
        const name = m[1].toLowerCase();
        if (!codeLabels.has(name)) codeLabels.set(name, instructions.length);
        continue;
      }
      if (/^([A-Za-z_.$?][\w.$?]*\s+)?ENDP$/i.test(text)) continue;

      // END
      if (/^END\b/i.test(text)) {
        ended = true;
        continue;
      }

      // ORG (data placement)
      m = text.match(/^ORG\s+(.+)$/i);
      if (m) {
        if (section !== "data") err(lineNo, `ORG is only supported inside .DATA`);
        else {
          const v = evalExpr(m[1], ctx, lineNo);
          if (v < 0 || v > 0xfff0) err(lineNo, `invalid ORG offset ${v}`);
          while (data.length < v) data.push(0);
        }
        continue;
      }

      if (section === "data") {
        // NAME DB ...  |  DB ...
        m = text.match(/^([A-Za-z_.$?][\w.$?]*)\s+(DB|DW|DD)\s+(.+)$/i);
        let label: string | null = null;
        let type: "DB" | "DW" | "DD";
        let rest: string;
        if (m) {
          label = m[1];
          type = m[2].toUpperCase() as "DB" | "DW" | "DD";
          rest = m[3];
        } else {
          m = text.match(/^(DB|DW|DD)\s+(.+)$/i);
          if (!m) {
            err(lineNo, `expected a data definition (DB/DW/DD) inside .DATA — '${text}'`);
            continue;
          }
          type = m[1].toUpperCase() as "DB" | "DW" | "DD";
          rest = m[2];
        }
        const start = data.length;
        parseDataValues(rest, type, ctx, data, lineNo);
        if (label) {
          const low = label.toLowerCase();
          if (dataLabels.has(low) || consts.has(low)) err(lineNo, `duplicate data label '${label}'`);
          else dataLabels.set(low, { offset: start, size: data.length - start, type });
        }
        continue;
      }

      if (section === "code") {
        m = text.match(/^(\w+)\s*(.*)$/);
        if (!m) continue;
        let op = m[1].toUpperCase();
        let rest = m[2].trim();
        let rep: Instruction["rep"] = null;

        if (["REP", "REPE", "REPZ", "REPNE", "REPNZ"].includes(op)) {
          rep = op.startsWith("REPN") ? "REPNE" : op === "REP" ? "REP" : "REPE";
          const m2 = rest.match(/^(\w+)\s*(.*)$/);
          if (!m2) {
            err(lineNo, `${op} needs a string instruction (e.g. ${op} MOVSB)`);
            continue;
          }
          op = m2[1].toUpperCase();
          rest = m2[2].trim();
        }

        if (!MNEMONICS.has(op)) {
          err(lineNo, `unknown instruction '${op}'`);
          continue;
        }

        const ops: Operand[] = [];
        if (rest) {
          for (const part of splitTop(rest)) ops.push(parseOperand(part, ctx, lineNo));
        }
        instructions.push({ op, rep, ops, line: lineNo, addr: 0, size: 0, raw: text });
        continue;
      }

      err(lineNo, `statement outside .DATA / .CODE section — '${text}'`);
    } catch (e) {
      err(lineNo, e instanceof Error ? e.message.replace(/^line \d+: /, "") : String(e));
    }
  }

  /* --- pass 2: resolve jump targets --- */
  if (errors.length === 0) {
    for (const ins of instructions) {
      if (!BRANCHES.has(ins.op) && !["RET", "RETF"].includes(ins.op)) continue;
      if (ins.op === "RET" || ins.op === "RETF") continue;
      const op0 = ins.ops[0];
      if (!op0) {
        errors.push({ line: ins.line, message: `${ins.op} needs a target label` });
        continue;
      }
      if (op0.kind === "label") {
        const t = codeLabels.get(op0.name.toLowerCase());
        if (t === undefined) {
          errors.push({ line: ins.line, message: `unknown label '${op0.name}'` });
        } else op0.target = t;
      } else if (op0.kind !== "mem" || ins.op !== "JMP") {
        errors.push({ line: ins.line, message: `${ins.op} target must be a label` });
      }
    }
  }

  /* --- assign pseudo addresses --- */
  let addr = CODE_BASE;
  for (const ins of instructions) {
    let sz = 2;
    for (const o of ins.ops) {
      if (o.kind === "imm") sz += o.value >= -128 && o.value <= 255 ? 1 : 2;
      else if (o.kind === "mem") sz += 2 + (o.disp !== 0 || o.base === 5 ? 2 : 0);
    }
    sz = Math.min(Math.max(sz, 2), 8);
    ins.addr = addr;
    ins.size = sz;
    addr += sz;
  }
  const codeBytes = addr - CODE_BASE;

  /* --- populate consts with data labels for late expressions handled already --- */

  const entryIndex = codeLabels.get("main") ?? 0;
  const labelList = [...dataLabels.entries()]
    .map(([name, d]) => ({ name: name.toUpperCase(), offset: d.offset }))
    .sort((a, b) => a.offset - b.offset);

  return {
    ok: errors.length === 0,
    errors,
    instructions,
    data,
    dataLabels,
    codeLabels,
    labelList,
    stackSize,
    entryIndex,
    codeBytes,
  };
}

export const EMU = {
  CODE_BASE,
  DATA_SEG_VALUE,
  CS_INIT: 0x0700,
  SS_INIT: 0x0900,
  ES_INIT: 0x0800,
  IP_INIT: CODE_BASE,
};
