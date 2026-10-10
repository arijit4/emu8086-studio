import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  Compartment,
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { autocompletion, completionKeymap, type CompletionSource } from "@codemirror/autocomplete";
import { search } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { ASM_COMPLETION_WORDS, asmLanguage } from "../editor/asm8086";

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

function mapPosition(
  source: string,
  formatted: string,
  position: number,
  sourceDoc: EditorView["state"]["doc"],
  formattedDoc: EditorView["state"]["doc"]
) {
  const sourceLine = sourceDoc.lineAt(Math.min(position, source.length));
  const formattedLine = formattedDoc.line(Math.min(sourceLine.number, formattedDoc.lines));
  const column = Math.min(position - sourceLine.from, formattedLine.length);
  return Math.min(formattedLine.from + column, formatted.length);
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  execLine: number | null;
  running: boolean;
  vimEnabled: boolean;
  completionEnabled: boolean;
  onRunShortcut: () => void;
  onStepShortcut?: () => void;
  onFormatShortcut: (source: string) => string;
  onViewReady?: (view: EditorView) => void;
  fontSize: number;
  theme: "dark" | "light";
}

export default function CodeEditor({
  value,
  onChange,
  execLine,
  running,
  vimEnabled,
  completionEnabled,
  onRunShortcut,
  onStepShortcut,
  onFormatShortcut,
  onViewReady,
  fontSize,
  theme,
}: Props) {
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartment = useMemo(() => new Compartment(), []);
  const completionCompartment = useMemo(() => new Compartment(), []);
  const initialVim = useRef(vimEnabled);
  const initialCompletion = useRef(completionEnabled);
  const runRef = useRef(onRunShortcut);
  const stepRef = useRef(onStepShortcut);
  const formatRef = useRef(onFormatShortcut);
  runRef.current = onRunShortcut;
  stepRef.current = onStepShortcut;
  formatRef.current = onFormatShortcut;

  const completionSource = useMemo<CompletionSource>(
    () => (context) => {
      const word = context.matchBefore(/[A-Za-z_.$?][\w.$@?]*/);
      if (!word && !context.explicit) return null;

      const labels = new Set<string>();
      for (const line of context.state.doc.iterLines()) {
        const label = line.match(/^\s*([A-Za-z_.$?][\w.$@?]*):/);
        if (label) labels.add(label[1]);
      }

      return {
        from: word?.from ?? context.pos,
        options: [
          ...ASM_COMPLETION_WORDS.map((label) => ({ label, type: "keyword" })),
          ...[...labels].map((label) => ({ label, type: "variable" })),
        ],
        validFor: /[A-Za-z_.$?][\w.$@?]*/,
      };
    },
    []
  );

  const extensions = useMemo<Extension[]>(
    () => [
      vimCompartment.of(initialVim.current ? vim({ status: true }) : []),
      completionCompartment.of(
        initialCompletion.current
          ? autocompletion({ override: [completionSource] })
          : []
      ),
      search({ top: false }),
      asmLanguage(theme),
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
          {
            key: "Mod-Alt-l",
            run: (view) => {
              const source = view.state.doc.toString();
              const formatted = formatRef.current(source);
              if (formatted !== source) {
                const formattedDoc = view.state.toText(formatted);
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: formatted },
                  selection: EditorSelection.create(
                    view.state.selection.ranges.map((range) =>
                      EditorSelection.range(
                        mapPosition(source, formatted, range.anchor, view.state.doc, formattedDoc),
                        mapPosition(source, formatted, range.head, view.state.doc, formattedDoc)
                      )
                    ),
                    view.state.selection.mainIndex
                  ),
                });
              }
              return true;
            },
          },
        ])
      ),
      keymap.of(completionKeymap),
      EditorView.lineWrapping,
    ],
    [completionCompartment, completionSource, theme, vimCompartment]
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
    view.dispatch({
      effects: completionCompartment.reconfigure(
        completionEnabled ? autocompletion({ override: [completionSource] }) : []
      ),
    });
  }, [completionEnabled, completionCompartment, completionSource]);

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
      style={{ "--editor-font-size": `${fontSize}px` } as React.CSSProperties}
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
