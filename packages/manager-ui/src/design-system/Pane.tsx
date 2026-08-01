import type { HTMLAttributes, ReactNode } from 'react';

export interface PaneProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  label?: string;
  tone?: 'base' | 'raised';
}

export function Pane({ children, className = '', label, tone = 'base', ...props }: PaneProps) {
  return (
    <section className={`rg-pane rg-pane--${tone} ${className}`.trim()} aria-label={label} {...props}>
      {children}
    </section>
  );
}

export function PaneHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <header className={`rg-pane__header ${className}`.trim()}>{children}</header>;
}
