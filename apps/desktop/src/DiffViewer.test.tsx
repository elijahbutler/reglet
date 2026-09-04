import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { DiffViewer, parseUnifiedDiff } from '@reglet/manager-ui';

describe('DiffViewer', () => {
  const sampleDiff = `--- a/.claude/CLAUDE.md
+++ b/.claude/CLAUDE.md
@@ -1,3 +1,4 @@
 # General instructions
-Prefer npm
+Prefer pnpm or bun
+Never use yarn
`;

  test('parses unified diff lines into added, removed, and hunk structures', () => {
    const { lines, splitRows } = parseUnifiedDiff(sampleDiff);
    expect(lines.some((l) => l.type === 'added' && l.text === '+Prefer pnpm or bun')).toBe(true);
    expect(lines.some((l) => l.type === 'removed' && l.text === '-Prefer npm')).toBe(true);
    expect(lines.some((l) => l.type === 'hunk')).toBe(true);
    expect(splitRows.length).toBeGreaterThan(0);
  });

  test('renders unified diff with line numbers and accessibility region', () => {
    render(<DiffViewer diff={sampleDiff} path="~/.claude/CLAUDE.md" />);

    const region = screen.getByRole('region', { name: 'Exact unified diff for ~/.claude/CLAUDE.md' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('Prefer pnpm or bun');
    expect(region).toHaveTextContent('Prefer npm');
  });

  test('toggles between unified and split side-by-side mode', () => {
    render(<DiffViewer diff={sampleDiff} path="~/.claude/CLAUDE.md" />);

    const splitBtn = screen.getByRole('button', { name: 'Split' });
    fireEvent.click(splitBtn);

    expect(screen.getByText('Prefer pnpm or bun')).toBeInTheDocument();
    expect(screen.getByText('Prefer npm')).toBeInTheDocument();

    const unifiedBtn = screen.getByRole('button', { name: 'Unified' });
    fireEvent.click(unifiedBtn);
    expect(screen.getByText('+Prefer pnpm or bun')).toBeInTheDocument();
  });

  test('renders empty diff placeholder when diff is blank', () => {
    render(<DiffViewer diff="" path="~/.cursorrules" note="No changes detected." />);
    expect(screen.getByText('No changes detected.')).toBeInTheDocument();
  });

  test('correctly preserves added or removed content lines starting with multiple plus or minus characters', () => {
    const diffWithIncrements = `--- a/counter.ts
+++ b/counter.ts
@@ -1,2 +1,2 @@
---oldCounter;
++++newCounter;
`;
    const { lines, splitRows } = parseUnifiedDiff(diffWithIncrements);
    const removedLine = lines.find((l) => l.type === 'removed');
    const addedLine = lines.find((l) => l.type === 'added');

    expect(removedLine?.text).toBe('---oldCounter;');
    expect(addedLine?.text).toBe('++++newCounter;');
    expect(splitRows.some((r) => r.left?.text === '--oldCounter;')).toBe(true);
    expect(splitRows.some((r) => r.right?.text === '+++newCounter;')).toBe(true);
  });
});
