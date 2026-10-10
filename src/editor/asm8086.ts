import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { MNEMONICS, REG16, REG8, SEGIDX } from "../emulator/assembler";

const REGS = new Set([...Object.keys(REG16), ...Object.keys(REG8), ...Object.keys(SEGIDX)]);

const DIRECTIVES = new Set([
  "DB", "DW", "DD", "DQ", "DT", "PROC", "ENDP", "END", "ENDS", "EQU", "DUP",
  "ORG", "SEG", "ASSUME", "LABEL", "MACRO", "ENDM", "EVEN", "ALIGN",
  "INCLUDE", "PUBLIC", "EXTRN", "GROUP", "SEGMENT", "LOCAL",
]);

const TYPE_OPS = new Set(["BYTE", "WORD", "DWORD", "PTR", "OFFSET", "NEAR", "FAR", "SHORT", "TYPE", "LENGTH", "SIZE"]);

interface AsmState {
  labeled: boolean;
}

const BLOCK_OPENERS = new Set(["PROC", "SEGMENT", "MACRO"]);
const BLOCK_CLOSERS = new Set(["ENDP", "ENDS", "ENDM"]);
const SECTION_DIRECTIVES = new Set([".DATA", ".CODE", ".CONST", ".STACK"]);

export const ASM_COMPLETION_WORDS = [
  ...new Set([...MNEMONICS, ...REGS, ...DIRECTIVES, ...TYPE_OPS, ...SECTION_DIRECTIVES]),
];

function splitComment(line: string): [string, string] {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ";") {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, ""];
}

function normalizeCode(code: string): string {
  let result = "";
  let quote: "'" | '"' | null = null;
  let pendingSpace = false;

  for (const char of code.trim()) {
    if (quote) {
      result += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      if (pendingSpace && result) result += " ";
      pendingSpace = false;
      quote = char;
      result += char;
    } else if (/\s/.test(char)) {
      pendingSpace = true;
    } else if (char === ",") {
      result = result.trimEnd();
      result += ",";
      pendingSpace = true;
    } else {
      if (pendingSpace && result) result += " ";
      pendingSpace = false;
      result += char;
    }
  }

  return result.trim();
}

/**
 * Applies a predictable MASM-style layout without changing instruction text,
 * quoted strings, or comments.
 */
export function formatAssembly(source: string): string {
  let indentLevel = 0;
  let section = "";

  return source
    .split("\n")
    .map((line) => {
      const [rawCode, rawComment] = splitComment(line);
      const code = normalizeCode(rawCode);
      if (!code) return rawComment ? rawComment.trim() : "";

      const words = code.split(/\s+/);
      const first = words[0].toUpperCase();
      const second = words[1]?.toUpperCase();
      const hasLabel = /^[A-Za-z_.$?][\w.$?]*:/.test(code);
      const closesBlock = BLOCK_CLOSERS.has(first) || BLOCK_CLOSERS.has(second ?? "");
      const opensBlock = BLOCK_OPENERS.has(first) || BLOCK_OPENERS.has(second ?? "");

      if (closesBlock) indentLevel = Math.max(0, indentLevel - 1);
      if (SECTION_DIRECTIVES.has(first)) section = first;

      const isTopLevel = hasLabel || first.startsWith(".") || closesBlock || first === "END";
      const indent = isTopLevel ? 0 : indentLevel || (section === ".DATA" ? 1 : 0);
      const formatted = `${" ".repeat(indent * 4)}${code}${rawComment ? ` ${rawComment.trim()}` : ""}`;

      if (opensBlock) indentLevel += 1;
      return formatted;
    })
    .join("\n");
}

export const asm8086 = StreamLanguage.define<AsmState>({
  name: "asm8086",
  startState: () => ({ labeled: false }),
  token(stream, state) {
    if (stream.sol()) state.labeled = false;
    if (stream.eatSpace()) return null;

    if (stream.peek() === ";") {
      stream.skipToEnd();
      return "comment";
    }

    const ch = stream.peek();
    if (ch === "'" || ch === '"') {
      const q = stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === q) {
          if (stream.peek() === q) stream.next(); // '' escape
          else break;
        }
      }
      return "string";
    }

    if ("[],()+-*".includes(ch ?? "")) {
      stream.next();
      return "punctuation";
    }

    if (!state.labeled) {
      const lm = stream.match(/^[A-Za-z_.$?][\w.$?]*\s*:/, true);
      if (lm) {
        state.labeled = true;
        return "labelName";
      }
    }

    // numeric literal: starts with a digit (decimal / hexH / binB / octO)
    if (ch && /\d/.test(ch)) {
      stream.match(/^[0-9][\w.]*/, true, true);
      return "number";
    }

    // word: directive, mnemonic, register, identifier
    if (ch && /[@A-Za-z_.$?]/.test(ch)) {
      const m = stream.match(/^[@A-Za-z_.$?][\w.$@?]*/, true);
      if (!m) {
        stream.next();
        return null;
      }
      const raw = stream.current();
      const w = raw.toUpperCase();
      if (raw.startsWith(".")) return "keyword";
      if (raw.startsWith("@")) return "keyword"; // @DATA etc
      if (MNEMONICS.has(w)) return "atom";
      if (REGS.has(w)) return "typeName";
      if (DIRECTIVES.has(w)) return "keyword";
      if (TYPE_OPS.has(w)) return "operator";
      return null;
    }

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: ";" },
  },
});

const darkHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "#4b5563", fontStyle: "italic" },
  { tag: tags.string, color: "#bef264" },
  { tag: tags.number, color: "#5eead4" },
  { tag: tags.keyword, color: "#c4b5fd", fontWeight: "500" },
  { tag: tags.atom, color: "#7dd3fc", fontWeight: "500" },
  { tag: tags.typeName, color: "#fbbf24" },
  { tag: tags.labelName, color: "#f472b6" },
  { tag: tags.operator, color: "#e879f9" },
  { tag: tags.punctuation, color: "#63666f" },
  { tag: tags.invalid, color: "#f87171" },
]);

const lightHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.string, color: "#15803d" },
  { tag: tags.number, color: "#0f766e" },
  { tag: tags.keyword, color: "#7c3aed", fontWeight: "500" },
  { tag: tags.atom, color: "#0369a1", fontWeight: "500" },
  { tag: tags.typeName, color: "#b45309" },
  { tag: tags.labelName, color: "#be185d" },
  { tag: tags.operator, color: "#a21caf" },
  { tag: tags.punctuation, color: "#64748b" },
  { tag: tags.invalid, color: "#dc2626" },
]);

export function asmLanguage(theme: "dark" | "light" = "dark"): Extension {
  return [asm8086, syntaxHighlighting(theme === "light" ? lightHighlight : darkHighlight)];
}
