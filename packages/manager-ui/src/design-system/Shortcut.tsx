export interface ShortcutProps {
  keys: string[];
  label?: string;
  className?: string;
}

export function Shortcut({ keys, label, className }: ShortcutProps) {
  return (
    <span className={`rg-shortcut ${className ?? ''}`} aria-label={label === undefined ? keys.join(' ') : `${label}: ${keys.join(' ')}`}>
      {keys.map((key) => <kbd key={key}>{key}</kbd>)}
      {label === undefined ? null : <span>{label}</span>}
    </span>
  );
}
