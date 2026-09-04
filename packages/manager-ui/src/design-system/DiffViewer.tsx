import React, { useMemo, useState } from 'react';

export interface DiffViewerProps {
  diff: string;
  path: string;
  redacted?: boolean;
  note?: string;
  initialMode?: 'unified' | 'split';
  className?: string;
}

interface ParsedLine {
  type: 'added' | 'removed' | 'context' | 'hunk' | 'header';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface SplitRow {
  left?: {
    lineNumber: number;
    text: string;
    type: 'removed' | 'context';
  };
  right?: {
    lineNumber: number;
    text: string;
    type: 'added' | 'context';
  };
  hunkHeader?: string;
}

export function parseUnifiedDiff(diff: string): { lines: ParsedLine[]; splitRows: SplitRow[] } {
  const rawLines = diff.split('\n');
  const lines: ParsedLine[] = [];
  const splitRows: SplitRow[] = [];

  let oldCounter = 0;
  let newCounter = 0;

  const hunkRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

  let pendingLeft: { lineNumber: number; text: string; type: 'removed' }[] = [];
  let pendingRight: { lineNumber: number; text: string; type: 'added' }[] = [];

  const flushPending = () => {
    const maxLen = Math.max(pendingLeft.length, pendingRight.length);
    for (let i = 0; i < maxLen; i++) {
      splitRows.push({
        left: pendingLeft[i],
        right: pendingRight[i],
      });
    }
    pendingLeft = [];
    pendingRight = [];
  };

  for (const raw of rawLines) {
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      lines.push({ type: 'header', text: raw });
      continue;
    }

    const hunkMatch = hunkRegex.exec(raw);
    if (hunkMatch) {
      flushPending();
      oldCounter = parseInt(hunkMatch[1] ?? '1', 10);
      newCounter = parseInt(hunkMatch[2] ?? '1', 10);
      lines.push({ type: 'hunk', text: raw });
      splitRows.push({ hunkHeader: raw });
      continue;
    }

    if (raw.startsWith('+')) {
      const lineNum = newCounter++;
      lines.push({
        type: 'added',
        text: raw,
        newLineNumber: lineNum,
      });
      pendingRight.push({
        lineNumber: lineNum,
        text: raw.slice(1),
        type: 'added',
      });
    } else if (raw.startsWith('-')) {
      const lineNum = oldCounter++;
      lines.push({
        type: 'removed',
        text: raw,
        oldLineNumber: lineNum,
      });
      pendingLeft.push({
        lineNumber: lineNum,
        text: raw.slice(1),
        type: 'removed',
      });
    } else {
      flushPending();
      const oldNum = oldCounter > 0 ? oldCounter++ : undefined;
      const newNum = newCounter > 0 ? newCounter++ : undefined;
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      lines.push({
        type: 'context',
        text: raw,
        oldLineNumber: oldNum,
        newLineNumber: newNum,
      });
      if (oldNum !== undefined || newNum !== undefined) {
        splitRows.push({
          left: oldNum !== undefined ? { lineNumber: oldNum, text, type: 'context' } : undefined,
          right: newNum !== undefined ? { lineNumber: newNum, text, type: 'context' } : undefined,
        });
      }
    }
  }

  flushPending();
  return { lines, splitRows };
}

export function DiffViewer({
  diff,
  path,
  redacted = false,
  note,
  initialMode = 'unified',
  className = '',
}: DiffViewerProps) {
  const [mode, setMode] = useState<'unified' | 'split'>(initialMode);
  const { lines, splitRows } = useMemo(() => parseUnifiedDiff(diff), [diff]);

  const ariaLabel = `${redacted ? 'Redacted' : 'Exact'} unified diff for ${path}`;

  if (diff.trim().length === 0) {
    return (
      <div
        className={`rg-review-diff rg-review-diff--empty p-4 text-xs font-mono text-[var(--rg-muted,#8a8f98)] border border-[var(--rg-border,rgba(255,255,255,0.08))] rounded-lg bg-[var(--rg-surface,#101216)] ${className}`}
        role="region"
        aria-label={`${redacted ? 'Redacted' : 'Exact'} diff for ${path}`}
      >
        {note ?? 'No textual difference is available for this operation.'}
      </div>
    );
  }

  return (
    <div
      className={`rg-review-diff flex flex-col border border-[var(--rg-border,rgba(255,255,255,0.08))] rounded-lg overflow-hidden bg-[var(--rg-canvas,#08090b)] text-xs font-mono select-text ${className}`}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      {/* Diff Bar / Mode Controls */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--rg-surface,#101216)] border-b border-[var(--rg-border,rgba(255,255,255,0.08))] text-[var(--rg-muted,#8a8f98)] select-none">
        <div className="flex items-center gap-2 overflow-hidden truncate">
          <span className="font-semibold text-[var(--rg-text,#f3f3f2)] truncate">{path}</span>
          {redacted && (
            <span className="px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-400 border border-amber-800/50 text-[10px] uppercase font-bold tracking-wider">
              Redacted
            </span>
          )}
        </div>
        <div className="flex items-center bg-black/40 p-0.5 rounded border border-[var(--rg-border,rgba(255,255,255,0.06))]">
          <button
            type="button"
            onClick={() => setMode('unified')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              mode === 'unified'
                ? 'bg-[var(--rg-surface,#20242c)] text-[var(--rg-text,#f3f3f2)] shadow-sm'
                : 'text-[var(--rg-muted,#8a8f98)] hover:text-[var(--rg-text,#f3f3f2)]'
            }`}
          >
            Unified
          </button>
          <button
            type="button"
            onClick={() => setMode('split')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              mode === 'split'
                ? 'bg-[var(--rg-surface,#20242c)] text-[var(--rg-text,#f3f3f2)] shadow-sm'
                : 'text-[var(--rg-muted,#8a8f98)] hover:text-[var(--rg-text,#f3f3f2)]'
            }`}
          >
            Split
          </button>
        </div>
      </div>

      {redacted && (
        <p className="rg-review-diff__notice px-3 py-1.5 bg-amber-950/20 text-amber-400/90 text-[11px] border-b border-amber-900/30 m-0">
          Credential-like MCP values are hidden in this preview.
        </p>
      )}

      {/* Diff Body */}
      {mode === 'unified' ? (
        <pre className="m-0 p-0 overflow-x-auto text-[12px] leading-relaxed">
          <code>
            {lines.map((line, index) => {
              const isAdded = line.type === 'added';
              const isRemoved = line.type === 'removed';
              const isHunk = line.type === 'hunk';
              const isHeader = line.type === 'header';

              let bgClass = '';
              let textClass = 'text-[var(--rg-text,#f3f3f2)]';
              let lineTypeClass = 'rg-review-diff__line';

              if (isAdded) {
                bgClass = 'bg-emerald-950/35 hover:bg-emerald-900/40';
                textClass = 'text-emerald-300';
                lineTypeClass += ' rg-review-diff__line--added';
              } else if (isRemoved) {
                bgClass = 'bg-rose-950/35 hover:bg-rose-900/40';
                textClass = 'text-rose-300';
                lineTypeClass += ' rg-review-diff__line--removed';
              } else if (isHunk) {
                bgClass = 'bg-blue-950/30 text-blue-300/80 font-bold';
                lineTypeClass += ' rg-review-diff__line--hunk';
              } else if (isHeader) {
                bgClass = 'bg-[var(--rg-surface,#14171d)] text-[var(--rg-muted,#8a8f98)]';
                lineTypeClass += ' rg-review-diff__line--file';
              }

              return (
                <span
                  key={`${index}:${line.text}`}
                  className={`block px-3 py-0.5 border-l-2 ${
                    isAdded
                      ? 'border-emerald-500'
                      : isRemoved
                        ? 'border-rose-500'
                        : isHunk
                          ? 'border-blue-500'
                          : 'border-transparent'
                  } ${bgClass} ${textClass} ${lineTypeClass}`}
                >
                  {line.text.length === 0 ? ' ' : line.text}
                </span>
              );
            })}
          </code>
        </pre>
      ) : (
        /* Split (Side-by-Side) Diff */
        <div className="overflow-x-auto text-[12px] leading-relaxed">
          <div className="min-w-full divide-y divide-[var(--rg-border,rgba(255,255,255,0.04))]">
            {splitRows.map((row, index) => {
              if (row.hunkHeader) {
                return (
                  <div
                    key={`hunk-${index}`}
                    className="col-span-2 px-3 py-1 bg-blue-950/30 text-blue-300/80 font-bold border-l-2 border-blue-500"
                  >
                    {row.hunkHeader}
                  </div>
                );
              }

              const leftRemoved = row.left?.type === 'removed';
              const rightAdded = row.right?.type === 'added';

              return (
                <div key={`split-${index}`} className="grid grid-cols-2 divide-x divide-[var(--rg-border,rgba(255,255,255,0.06))]">
                  {/* Left (Current / Disk) */}
                  <div
                    className={`flex items-start px-2 py-0.5 overflow-hidden ${
                      leftRemoved ? 'bg-rose-950/35 text-rose-300 border-l-2 border-rose-500' : 'text-[var(--rg-muted,#8a8f98)] border-l-2 border-transparent'
                    }`}
                  >
                    <span className="w-8 shrink-0 text-right pr-2 select-none opacity-40">
                      {row.left?.lineNumber ?? ''}
                    </span>
                    <span className="shrink-0 w-3 select-none text-rose-400">
                      {leftRemoved ? '-' : ''}
                    </span>
                    <span className="truncate font-mono">{row.left?.text ?? ''}</span>
                  </div>

                  {/* Right (Canonical / Incoming) */}
                  <div
                    className={`flex items-start px-2 py-0.5 overflow-hidden ${
                      rightAdded ? 'bg-emerald-950/35 text-emerald-300 border-l-2 border-emerald-500' : 'text-[var(--rg-text,#f3f3f2)] border-l-2 border-transparent'
                    }`}
                  >
                    <span className="w-8 shrink-0 text-right pr-2 select-none opacity-40">
                      {row.right?.lineNumber ?? ''}
                    </span>
                    <span className="shrink-0 w-3 select-none text-emerald-400">
                      {rightAdded ? '+' : ''}
                    </span>
                    <span className="truncate font-mono">{row.right?.text ?? ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
