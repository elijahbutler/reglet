import { Archive, FileDiff, Plus, RefreshCw, Search, Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onPreview: () => void;
  onRefresh: () => void;
  onArchive: () => void;
  onSettings: () => void;
}

export function CommandPalette({ open, onClose, onNew, onPreview, onRefresh, onArchive, onSettings }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const commands = useMemo(() => [
    { label: 'Create new artifact', icon: Plus, run: onNew },
    { label: 'Preview projection diff', icon: FileDiff, run: onPreview },
    { label: 'Refresh manager snapshot', icon: RefreshCw, run: onRefresh },
    { label: 'Archive selected artifact', icon: Archive, run: onArchive },
    { label: 'Open Settings', icon: Settings, run: onSettings },
  ].filter((command) => command.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [onArchive, onNew, onPreview, onRefresh, onSettings, query]);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  if (!open) return null;
  return <div className="rg-palette-backdrop" role="presentation" onMouseDown={onClose}><section className="rg-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}><label><Search size={16} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands…" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} /></label><div>{commands.map(({ label, icon: Icon, run }) => <button type="button" key={label} onClick={() => { run(); onClose(); }}><Icon size={15} /><span>{label}</span></button>)}</div></section></div>;
}
