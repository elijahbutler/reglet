import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: 'primary' | 'secondary' | 'danger' | 'quiet';
  icon?: ReactNode;
}

export function Button({ children, className = '', icon, tone = 'secondary', type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={`rg-button rg-button--${tone} ${className}`.trim()} {...props}>
      {icon === undefined ? null : <span className="rg-button__icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}
