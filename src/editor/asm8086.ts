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

export const asmHighlight = HighlightStyle.define([
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

export function asmLanguage(): Extension {
  return [asm8086, syntaxHighlighting(asmHighlight)];
}
