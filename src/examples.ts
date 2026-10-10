export interface Example {
  id: string;
  title: string;
  tag: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "ex0",
    title: "Hello!",
    tag: "Get started with emu8086 studio",
    code: `; Click "Run" (or Ctrl+Enter) to execute the program.

.model small
.stack 100h

.DATA
    line01 DB '                         ______ _______     ______   ________     ', 13, 10, '$'
    line02 DB '_____    ______ _____   /  __  \\\\   _  \\   /  __  \\ /  _____/     ', 13, 10, '$'
    line03 DB '\\__  \\  /  ___//     \\  >      </  /_\\  \\  >      </   __  \\      ', 13, 10, '$'
    line04 DB ' / __ \\_\\___ \\|  Y Y  \\/   --   \\  \\_/   \\/   --   \\  |__\\  \\     ', 13, 10, '$'
    line05 DB '(____  /____  >__|_|  /\\______  /\\_____  /\\______  /\\_____  /     ', 13, 10, '$'
    line06 DB '     \\/     \\/      \\/        \\/       \\/        \\/       \\/      ', 13, 10, '$'

.CODE
MAIN PROC
    MOV AX, @DATA
    MOV DS, AX

    MOV AH, 09h

    LEA DX, line01
    INT 21h
    LEA DX, line02
    INT 21h
    LEA DX, line03
    INT 21h
    LEA DX, line04
    INT 21h
    LEA DX, line05
    INT 21h
    LEA DX, line06
    INT 21h
    LEA DX, line07
    INT 21h
    LEA DX, line08
    INT 21h
    LEA DX, line09
    INT 21h
    LEA DX, line10
    INT 21h
    LEA DX, line11
    INT 21h
    LEA DX, line12
    INT 21h
    LEA DX, line13
    INT 21h

    MOV AH, 00h
    INT 16h

    MOV AH, 4Ch
    INT 21h
    MAIN ENDP
END START`
  },
  {
    id: "ex1",
    title: "Print & Echo Basics",
    tag: "AH=02 / 09 string + char output",
    code: `.MODEL SMALL
.STACK 100H
.DATA
V1 DB 'A $'
NEWLINE DB 10,13,24H
MSG DB 'EXECUTING $'

.CODE
MAIN PROC
    MOV AX,@DATA
    MOV DS,AX

    MOV AH,9
    LEA DX,MSG
    INT 21H

    MOV AH,9
    LEA DX,NEWLINE
    INT 21H

    MOV AH,2
    MOV DL,"A"
    INT 21H

    MOV AH,9
    LEA DX,NEWLINE
    INT 21H

    MOV AH,9
    LEA DX,MSG
    INT 21H

    MOV AH,9
    LEA DX,NEWLINE
    INT 21H

    MOV AH,2
    MOV DL,41H
    INT 21H

    MOV AH,4CH
    INT 21H
    MAIN ENDP
END MAIN
`,
  },
  {
    id: "ex2",
    title: "Hello, World Loop",
    tag: "AH=09 infinite loop (press Pause)",
    code: `.model small
.stack 100h
.data
msg db 0ah,0dh, "Hello, World $"
.code
main proc
start:
 mov ah,9   ; print function is 9.
 lea dx,msg ; load offset of msg into dx.
 int 21h    ; do it!
 jmp start
`,
  },
  {
    id: "ex3",
    title: "Read & Echo a Key",
    tag: "AH=01 input with echo",
    code: `.MODEL SMALL
.STACK 100H
.DATA
NEWLINE DB 0AH,0DH,'$'
.CODE

MAIN PROC
    MOV AX,@DATA
    MOV DS,AX

    MOV AH,1
    INT 21H
    MOV BL,AL

    MOV AH,9
    LEA CX,NEWLINE
    INT 21H

    MOV AH,2
    MOV DL,BL
    INT 21H

    MOV AH,4CH
    INT 21H

    MAIN ENDP
END MAIN
`,
  },
  {
    id: "ex4",
    title: "Prompt, Input, Display",
    tag: "AH=01 / 02 carrige-return echo",
    code: `.MODEL SMALL
.STACK 100H
.CODE
MAIN PROC
    ;DISPLAY PROMPT
    MOV AH,2   ; DISPLAY CHARACTER FUNCTION
    MOV DL,'?' ; CHARACTER IS '?'
    INT 21H   ;DISPLAY IT
    ;IMPUT A CHARACTER

    MOV AH,1 ;READ CHARACTER FUNCTION
    INT 21H  ;SEND INTERRUPT
    MOV BL,AL;SAVE IT IN BL
    ;GO TO A NEW LINE

    MOV AH,2  ;DISPLAY CHARACTER FUNCTION
    MOV DL,0DH;CARRIAGE RETURN
    INT 21H   ;EXECUTE LINE FEED
    ;DISPLAY CHARACTER
    MOV DL,BL ; RETRIEVE CHARACTER
    INT 21H   ;AND DISPLAY IT
    ;RETURN TO DOS
    MOV AH, 4CH ;DOS EXIT FUNCTION
    INT 21H     ;EXIT TO DOS
    MAIN ENDP
         END MAIN
`,
  },
  {
    id: "ex5",
    title: "LOOP: Countdown",
    tag: "LOOP + flags + AH=02",
    code: `.MODEL SMALL
.STACK 100H
.DATA
NL DB 10,13,'$'
.CODE
MAIN PROC
    MOV AX,@DATA
    MOV DS,AX

    MOV CX,9        ; loop counter
NEXT:
    MOV AX,CX
    ADD AL,'0'      ; digit -> ascii
    MOV DL,AL
    MOV AH,2
    INT 21H
    LOOP NEXT       ; CX-- and jump while CX != 0

    MOV AH,9
    LEA DX,NL
    INT 21H

    MOV AH,4CH
    INT 21H
    MAIN ENDP
END MAIN
`,
  },
  {
    id: "ex6",
    title: "Sum 1..10, Print Decimal",
    tag: "DIV, PUSH/POP, TEST/JNZ",
    code: `.MODEL SMALL
.STACK 100H
.DATA
NL DB 10,13,'$'
.CODE
MAIN PROC
    MOV AX,@DATA
    MOV DS,AX

    XOR BX,BX       ; BX = accumulator
    MOV CX,10
SUMLOOP:
    ADD BX,CX
    LOOP SUMLOOP    ; BX = 1+2+...+10 = 55

    MOV AX,BX       ; print AX as decimal
    MOV BX,10
    XOR CX,CX       ; CX = digit count
PUSH_DIGITS:
    XOR DX,DX
    DIV BX          ; AX = quot, DX = remainder
    PUSH DX         ; save digit on the stack
    INC CX
    TEST AX,AX
    JNZ PUSH_DIGITS
PRINT_DIGITS:
    POP DX
    ADD DL,'0'
    MOV AH,2
    INT 21H
    LOOP PRINT_DIGITS

    MOV AH,9
    LEA DX,NL
    INT 21H

    MOV AH,4CH
    INT 21H
    MAIN ENDP
END MAIN
`,
  },
  {
    id: "ex7",
    title: "Buffered Keyboard Input",
    tag: "AH=0Ah line input buffer",
    code: `.MODEL SMALL
.STACK 100H
.DATA
BUF  DB 20,?,20 DUP('$')
ASK  DB 'TYPE YOUR NAME AND PRESS ENTER: $'
NL   DB 10,13,'$'
OUT1 DB 10,13,'HELLO, $'
.CODE
MAIN PROC
    MOV AX,@DATA
    MOV DS,AX

    MOV AH,9
    LEA DX,ASK
    INT 21H

    MOV AH,0AH      ; buffered input into BUF
    LEA DX,BUF
    INT 21H

    MOV AH,9
    LEA DX,OUT1
    INT 21H

    LEA DX,BUF+2    ; typed text starts at byte 3
    INT 21H

    MOV AH,9
    LEA DX,NL
    INT 21H

    MOV AH,4CH
    INT 21H
    MAIN ENDP
END MAIN
`,
  },
];
