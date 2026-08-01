import { useEffect, useState } from 'react';

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function LazyTextDiff({ before, after, label }: { before: string; after: string; label: string }) {
  const [parts, setParts] = useState<DiffPart[]>();
  useEffect(() => {
    let disposed = false;
    setParts(undefined);
    void import('diff').then((module) => {
      if (!disposed) setParts(module.diffLines(before, after));
    });
    return () => { disposed = true; };
  }, [after, before]);
  return <div className="rg-text-diff" role="region" aria-label={label}>{parts === undefined ? <span>Loading diff…</span> : parts.length === 1 && parts[0]?.added !== true && parts[0]?.removed !== true ? <span>No unsaved difference.</span> : <pre>{parts.map((part, index) => <span className={part.added ? 'rg-diff-added' : part.removed ? 'rg-diff-removed' : ''} key={`${index}:${part.value.length}`}>{part.value}</span>)}</pre>}</div>;
}
