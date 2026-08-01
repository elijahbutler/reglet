export interface ShortcutProps {
  keys: string[];
  label?: string;
}

export function Shortcut({ keys, label }: ShortcutProps) {
  return (
    <span className="rg-shortcut" aria-label={label === undefined ? keys.join(' ') : `${label}: ${keys.join(' ')}`}>
      {keys.map((key) => <kbd key={key}>{key}</kbd>)}
      {label === undefined ? null : <span>{label}</span>}
    </span>
  );
}
