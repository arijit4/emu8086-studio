import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Compartment, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { search } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { asmLanguage } from "../editor/asm8086";

/* current-executing-line decoration */
const setExecLine = StateEffect.define<number | null>();
const execMark = Decoration.line({ class: "cm-exec-line" });

const execLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let v = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setExecLine)) {
        const ln = e.value;
        if (ln == null || ln < 1 || ln > tr.state.doc.lines) {
          v = Decoration.none;
        } else {
          const line = tr.state.doc.line(ln);
          v = Decoration.set([execMark.range(line.from)]);
        }
      }
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function jumpToLine(view: EditorView | null, line: number) {
  if (!view || line < 1 || line > view.state.doc.lines) return;
  const pos = view.state.doc.line(line);
  view.dispatch({
    selection: { anchor: pos.from, head: pos.from },
    effects: EditorView.scrollIntoView(pos.from, { y: "center" }),
  });
  view.focus();
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  execLine: number | null;
  running: boolean;
  vimEnabled: boolean;
  onRunShortcut: () => void;
  onStepShortcut?: () => void;
  onViewReady?: (view: EditorView) => void;
}

export default function CodeEditor({
  value,
  onChange,
  execLine,
  running,
  vimEnabled,
  onRunShortcut,
  onStepShortcut,
  onViewReady,
}: Props) {
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartment = useMemo(() => new Compartment(), []);
  const initialVim = useRef(vimEnabled);
  const runRef = useRef(onRunShortcut);
  const stepRef = useRef(onStepShortcut);
  runRef.current = onRunShortcut;
  stepRef.current = onStepShortcut;

  const extensions = useMemo<Extension[]>(
    () => [
      vimCompartment.of(initialVim.current ? vim({ status: true }) : []),
      search({ top: false }),
      asmLanguage(),
      execLineField,
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              runRef.current();
              return true;
            },
          },
          {
            key: "F10",
            run: () => {
              stepRef.current?.();
              return true;
            },
          },
        ])
      ),
      EditorView.lineWrapping,
    ],
    [vimCompartment]
  );

  /* hot-swap vim bindings without nuking editor state / undo history */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: vimCompartment.reconfigure(vimEnabled ? vim({ status: true }) : []) });
  }, [vimEnabled, vimCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const activeLine = running || execLine !== null ? execLine : null;
    const effects: Array<StateEffect<unknown>> = [setExecLine.of(activeLine) as StateEffect<unknown>];

    if (running && activeLine !== null && activeLine >= 1 && activeLine <= view.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(activeLine).from, { y: "nearest", yMargin: 24 }));
    }

    view.dispatch({ effects });
  }, [execLine, running]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
        onViewReady?.(view);
      }}
      extensions={extensions}
      height="100%"
      className="h-full"
      theme="none"
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: false,
        autocompletion: false,
        bracketMatching: false,
        closeBrackets: false,
        searchKeymap: false,
        lintKeymap: false,
        history: true,
        drawSelection: true,
        dropCursor: true,
        indentOnInput: false,
        rectangularSelection: false,
        crosshairCursor: false,
        highlightSelectionMatches: true,
        closeBracketsKeymap: false,
        completionKeymap: false,
        foldKeymap: false,
      }}
    />
  );
}
