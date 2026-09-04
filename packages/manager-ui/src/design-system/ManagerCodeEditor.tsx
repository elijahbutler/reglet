import React, { useCallback } from 'react';

export interface ManagerCodeEditorProps {
  value: string;
  language: 'markdown' | 'json';
  label: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

export function ManagerCodeEditor({
  value,
  language,
  label,
  readOnly = false,
  onChange,
}: ManagerCodeEditorProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e.target.value);
    },
    [onChange],
  );

  return (
    <div className="rg-code-editor w-full h-full flex flex-col" data-language={language}>
      <textarea
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={handleChange}
        spellCheck={false}
        className="w-full h-full p-5 bg-transparent text-[var(--rg-text,#f3f3f2)] focus:outline-none resize-none leading-relaxed selection:bg-[var(--rg-coral-soft,rgba(255,107,100,0.15))]"
        style={{
          fontFamily: 'var(--rg-font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
          minHeight: '100%',
        }}
      />
    </div>
  );
}
