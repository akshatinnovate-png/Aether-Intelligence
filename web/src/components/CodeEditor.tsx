import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

const chrome = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--bg)' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-2)', color: 'var(--faint)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--raise)', border: '1px solid var(--line-2)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--amber) 30%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderTop: '1px solid var(--line)' },
});

/** CodeMirror 6 editor with language detection from the file name. */
export function CodeEditor({ value, filename, onChange, readOnly, onSave }: { value: string; filename: string; onChange?: (v: string) => void; readOnly?: boolean; onSave?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    const dark = document.documentElement.dataset.theme !== 'light';
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          chrome,
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
          lang.current.of([]),
          ro.current.of(EditorState.readOnly.of(!!readOnly)),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave?.(), true) }]),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange?.(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) });
  }, [readOnly]);
  useEffect(() => {
    const desc = LanguageDescription.matchFilename(languages, filename);
    if (!desc) {
      view.current?.dispatch({ effects: lang.current.reconfigure([]) });
      return;
    }
    let cancelled = false;
    desc.load().then((support) => !cancelled && view.current?.dispatch({ effects: lang.current.reconfigure(support) }));
    return () => {
      cancelled = true;
    };
  }, [filename]);
  return <div ref={host} className="cm-host" />;
}
