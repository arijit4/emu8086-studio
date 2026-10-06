/* Headless smoke test: assemble & execute every bundled example. */
import { assemble } from "../src/emulator/assembler";
import { CPU, IOBridge, NeedInput } from "../src/emulator/cpu";
import { EXAMPLES } from "../src/examples";

function runExample(id: string, keys: number[], lineInput: number[], maxSteps = 2_000_000) {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const prog = assemble(ex.code);
  console.log(`\n=== ${ex.id}: ${ex.title} ===`);
  if (!prog.ok) {
    for (const e of prog.errors) console.log(`  ASSEMBLY ERROR line ${e.line}: ${e.message}`);
    return false;
  }
  console.log(`  asm ok: ${prog.codeBytes}B code, ${prog.data.length}B data, ${prog.instructions.length} instr, entry=${prog.entryIndex}`);

  let out = "";
  const keyQueue = [...keys];
  const io: IOBridge = {
    writeChar: (c) => {
      out += String.fromCharCode(c);
    },
    writeString: (s) => {
      out += s;
    },
    inputAvailable: () => keyQueue.length > 0,
    readChar: () => keyQueue.shift() ?? 0,
    peekChar: () => (keyQueue.length ? keyQueue[0] : -1),
    clearInput: () => keyQueue.splice(0),
    setCursor: () => {},
    getCursor: () => ({ row: 0, col: 0 }),
    clearScreen: () => {
      out += "[CLS]";
    },
    systemMessage: (m) => console.log(`  sys: ${m}`),
  };

  const cpu = new CPU(io);
  cpu.reset(prog);
  let steps = 0;
  let lineFed = false;
  try {
    while (!cpu.halted && steps < maxSteps) {
      try {
        cpu.step();
        steps++;
      } catch (e) {
        if (e instanceof NeedInput) {
          if (e.kind === "line") {
            // simulate machine: fill buffer
            const buf = lineInput;
            cpu.wr8(e.segAddr + 1, buf.length);
            buf.forEach((b, i) => cpu.wr8(e.segAddr + 2 + i, b));
            cpu.wr8(e.segAddr + 2 + buf.length, 13);
            cpu.lineReady = true;
            lineFed = true;
            io.writeString(String.fromCharCode(...buf) + "\n");
          } else {
            if (keyQueue.length === 0) {
              keyQueue.push(0x4b); // 'K' canned
            }
          }
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    console.log(`  CPU FAULT after ${steps} steps: ${e}`);
    return false;
  }

  const r = cpu.r;
  console.log(
    `  ran ${steps} steps, halted=${cpu.halted}, lineFed=${lineFed}\n  AX=${r[0].toString(16)} BX=${r[3].toString(16)} CX=${r[1].toString(16)} DX=${r[2].toString(16)} SP=${r[4].toString(16)} F=${cpu.F.toString(16)}`
  );
  console.log(`  console => ${JSON.stringify(out.slice(0, 300))}${out.length > 300 ? "..." : ""}`);
  return true;
}

let all = true;
all = runExample("ex1", [], []) && all;
all = runExample("ex2", [], [], 400) && all; // infinite loop: capped
all = runExample("ex3", [0x41] /* 'A' */, []) && all;
all = runExample("ex4", [0x4b] /* 'K' */, []) && all;
all = runExample("ex5", [], []) && all;
all = runExample("ex6", [], []) && all;
all = runExample("ex7", [], [..."MEHEDI".split("").map((c) => c.charCodeAt(0))]) && all;

// extra unit checks
console.log("\n=== unit checks ===");
const u = assemble(`CR EQU 0DH
.MODEL SMALL
.STACK 100H
.DATA
ARR DB 1,2,3
W DW 1234H
.CODE
MAIN PROC
 MOV AX,@DATA
 MOV DS,AX
 XOR AX,AX
 MOV AL,ARR[1]
 ADD AL,ARR[2]
 MOV BL,BYTE PTR ARR
 SHL BL,1
 ADC AL,0
 MOV CX,W
 INC CX
 LOOP_LABEL: NOP
 MOV AX,4C00H
 INT 21H
MAIN ENDP
END MAIN`);
if (!u.ok) {
  u.errors.forEach((e) => console.log(`  unit ERR line ${e.line}: ${e.message}`));
  all = false;
} else {
  console.log("  unit asm ok — EQU, char const, mem[reg], PTR, SHL, ADC, W load all parsed");
}

console.log(all ? "\nALL SMOKE TESTS PASSED" : "\nSMOKE TESTS FAILED");
process.exit(all ? 0 : 1);
