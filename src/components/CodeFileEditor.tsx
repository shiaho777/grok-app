/** Syntax-highlighted code file editor (CodeMirror 6). */

import { useEffect, useRef, useState } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  codeEditorLanguageExtension,
} from "@/lib/codeEditorLang";
import {
  codeEditorThemeExtensions,
  readCodeEditorTheme,
} from "@/lib/codeEditorTheme";

export type CodeFileEditorProps = {
  value: string;
  fileName?: string;
  language?: string;
  onChange: (text: string) => void;
  onSave?: () => void;
  disabled?: boolean;
  ariaLabel: string;
};

type EditorProbe = {
  valueLen: number;
  domLen: number;
  width: number;
  height: number;
  lines: number;
};

function readProbe(view: EditorView, value: string): EditorProbe {
  const rect = view.contentDOM.getBoundingClientRect();
  return {
    valueLen: value.length,
    domLen: view.contentDOM.innerText.length,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    lines: view.state.doc.lines,
  };
}

export function CodeFileEditor({
  value,
  fileName,
  language,
  onChange,
  onSave,
  disabled = false,
  ariaLabel,
}: CodeFileEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const editComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [probe, setProbe] = useState<EditorProbe | null>(null);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saveCmd = () => {
      onSaveRef.current?.();
      return true;
    };

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        highlightSelectionMatches(),
        history(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        keymap.of([
          { key: "Mod-s", run: saveCmd, preventDefault: true },
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        langComp.current.of(codeEditorLanguageExtension(fileName, language)),
        themeComp.current.of(codeEditorThemeExtensions(readCodeEditorTheme())),
        editComp.current.of([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        // Theme extensions already provide Atom One dark/light highlighting.
        // Do not mount defaultHighlightStyle (light-theme ink).
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    // Packaged WebViews can mount before the flex host has a real box;
    // re-measure so .cm-content gets a non-zero width.
    const measure = () => {
      view.requestMeasure();
      setProbe(readProbe(view, view.state.doc.toString()));
    };
    const raf = window.requestAnimationFrame(() => {
      measure();
      window.setTimeout(measure, 50);
      window.setTimeout(measure, 250);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per editor instance (parent should key by file tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) {
      setProbe(readProbe(view, value));
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
    view.requestMeasure();
    setProbe(readProbe(view, value));
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langComp.current.reconfigure(
        codeEditorLanguageExtension(fileName, language),
      ),
    });
  }, [fileName, language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editComp.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
  }, [disabled]);

  useEffect(() => {
    const apply = () => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeComp.current.reconfigure(
          codeEditorThemeExtensions(readCodeEditorTheme()),
        ),
      });
      view.requestMeasure();
    };
    apply();
    const el = document.documentElement;
    const mo = new MutationObserver(apply);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const showProbe =
    probe != null &&
    (probe.domLen === 0 ||
      probe.width < 8 ||
      (probe.valueLen > 0 && probe.domLen < Math.min(probe.valueLen, 8)));

  return (
    <div
      className="rp-code-editor"
      data-testid="code-file-editor"
      style={{ position: "relative", height: "100%", minHeight: 0 }}
    >
      <div ref={hostRef} style={{ height: "100%", minHeight: 0 }} />
      {showProbe ? (
        <div className="rp-code-editor__probe" role="status">
          {`CM probe value=${probe.valueLen} dom=${probe.domLen} lines=${probe.lines} box=${probe.width}x${probe.height}`}
        </div>
      ) : null}
    </div>
  );
}
