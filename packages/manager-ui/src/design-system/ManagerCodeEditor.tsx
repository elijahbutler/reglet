import { useEffect, useRef } from 'react';

export interface ManagerCodeEditorProps {
  value: string;
  language: 'markdown' | 'json';
  label: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

export function ManagerCodeEditor({ value, language, label, readOnly = false, onChange }: ManagerCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<import('@codemirror/view').EditorView | undefined>(undefined);
  const valueRef = useRef(value);
  const changeRef = useRef(onChange);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    let disposed = false;
    let view: import('@codemirror/view').EditorView | undefined;
    void Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      language === 'json' ? import('@codemirror/lang-json') : import('@codemirror/lang-markdown'),
    ]).then(([stateModule, viewModule, languageModule]) => {
      if (disposed || host.current === null) return;
      const languageExtension = language === 'json'
        ? (languageModule as typeof import('@codemirror/lang-json')).json()
        : (languageModule as typeof import('@codemirror/lang-markdown')).markdown();
      const extensions = [
        languageExtension,
        viewModule.EditorView.lineWrapping,
        viewModule.EditorView.contentAttributes.of({ 'aria-label': label }),
        viewModule.EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const next = update.state.doc.toString();
          valueRef.current = next;
          changeRef.current?.(next);
        }),
        stateModule.EditorState.readOnly.of(readOnly),
        viewModule.EditorView.editable.of(!readOnly),
        viewModule.EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--rg-font-mono)' },
          '.cm-content': { padding: '20px 22px', caretColor: 'var(--rg-coral)' },
          '.cm-line': { padding: '0' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--rg-coral)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--rg-coral-soft)' },
          '.cm-gutters': { display: 'none' },
          '&.cm-focused': { outline: 'none' },
        }),
      ];
      view = new viewModule.EditorView({
        parent: host.current,
        state: stateModule.EditorState.create({ doc: valueRef.current, extensions }),
      });
      editorRef.current = view;
    });
    return () => {
      disposed = true;
      view?.destroy();
      if (editorRef.current === view) editorRef.current = undefined;
    };
  }, [label, language, readOnly]);

  useEffect(() => {
    const view = editorRef.current;
    if (view === undefined || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="rg-code-editor" data-language={language} />;
}
