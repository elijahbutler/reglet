import { Archive, Plus, RefreshCw, Search, Settings, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../../design-system/useDialogFocus.js';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onRefresh: () => void;
  onArchive?: () => void;
  onSettings: () => void;
  onRunSetup?: () => void;
}

export function CommandPalette({ open, onClose, onNew, onRefresh, onArchive, onSettings, onRunSetup }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useDialogFocus<HTMLElement>(open, onClose);
  const commands = useMemo(() => [
    { label: 'Create new artifact', icon: Plus, run: onNew },
    { label: 'Refresh manager snapshot', icon: RefreshCw, run: onRefresh },
    ...(onArchive === undefined ? [] : [{ label: 'Archive selected artifact', icon: Archive, run: onArchive }]),
    ...(onRunSetup === undefined ? [] : [{ label: 'Run guided setup walkthrough', icon: Sparkles, run: onRunSetup }]),
    { label: 'Open Settings', icon: Settings, run: onSettings },
  ].filter((command) => command.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [onArchive, onNew, onRefresh, onRunSetup, onSettings, query]);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  if (!open) return null;
  return <div className="rg-palette-backdrop" role="presentation" onMouseDown={onClose}><section ref={dialog} tabIndex={-1} className="rg-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}><label><Search size={16} /><input ref={input} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands…" onKeyDown={(event) => {
    if (event.key !== 'Enter') return;
    const command = commands[0];
    if (command === undefined) return;
    event.preventDefault();
    command.run();
    onClose();
  }} /></label><div>{commands.length === 0 ? <p className="rg-palette-empty">No matching commands</p> : commands.map(({ label, icon: Icon, run }) => <button type="button" key={label} onClick={() => { run(); onClose(); }}><Icon size={15} /><span>{label}</span></button>)}</div></section></div>;
}
