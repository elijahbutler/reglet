import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface RowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  active?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Row({ active = false, children, className = '', leading, trailing, type = 'button', ...props }: RowProps) {
  return (
    <button
      type={type}
      className={`rg-row ${active ? 'rg-row--active' : ''} ${className}`.trim()}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {leading === undefined ? null : <span className="rg-row__leading" aria-hidden="true">{leading}</span>}
      <span className="rg-row__label">{children}</span>
      {trailing === undefined ? null : <span className="rg-row__trailing">{trailing}</span>}
    </button>
  );
}
