import { useEffect, useRef, type ReactNode } from 'react';

interface ModalDialogProps {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  closeDisabled?: boolean;
  role?: 'dialog' | 'alertdialog';
  backdropClassName?: string;
  dialogClassName?: string;
  hidden?: boolean;
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ModalDialog({
  children,
  labelledBy,
  describedBy,
  onClose,
  closeDisabled = false,
  role = 'dialog',
  backdropClassName = 'modal-backdrop',
  dialogClassName = 'modal',
  hidden = false,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]') ??
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    initialFocus?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (dialog === null || !dialog.contains(document.activeElement)) return;
      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className={backdropClassName} role="presentation">
      <div
        ref={dialogRef}
        className={dialogClassName}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-hidden={hidden || undefined}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
