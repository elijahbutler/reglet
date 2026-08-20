import { useEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocus<T extends HTMLElement>(open: boolean, onEscape?: () => void) {
  const dialogRef = useRef<T>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  const renderedOpenRef = useRef(open);
  if (open && !renderedOpenRef.current && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    returnFocusRef.current = document.activeElement;
  }
  renderedOpenRef.current = open;
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) {
      const rememberFocus = (event: FocusEvent) => {
        if (renderedOpenRef.current || !(event.target instanceof HTMLElement) || dialogRef.current?.contains(event.target)) return;
        returnFocusRef.current = event.target;
      };
      if (document.activeElement instanceof HTMLElement && !dialogRef.current?.contains(document.activeElement)) {
        returnFocusRef.current = document.activeElement;
      }
      document.addEventListener('focusin', rememberFocus);
      return () => document.removeEventListener('focusin', rememberFocus);
    }
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previousFocus = returnFocusRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overlay = dialog.parentElement;
    const background = overlay?.parentElement === null || overlay?.parentElement === undefined
      ? []
      : Array.from(overlay.parentElement.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
        .map((element) => ({
          element,
          supportsInert: 'inert' in element,
          wasInert: element.inert === true,
          ariaHidden: element.getAttribute('aria-hidden'),
          pointerEvents: element.style.pointerEvents,
        }));
    for (const item of background) {
      if (item.supportsInert) {
        item.element.inert = true;
      } else {
        item.element.setAttribute('aria-hidden', 'true');
        item.element.style.pointerEvents = 'none';
      }
    }

    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.closest('[aria-hidden="true"]'));
    const focusFirst = () => {
      if (dialog.contains(document.activeElement)) return;
      const preferred = dialog.querySelector<HTMLElement>('[autofocus]');
      (preferred ?? focusableElements()[0] ?? dialog).focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = elements[0];
      const last = elements.at(-1);
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || dialog.contains(event.target)) return;
      focusFirst();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      for (const item of background) {
        if (item.supportsInert) {
          item.element.inert = item.wasInert;
        } else {
          if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden');
          else item.element.setAttribute('aria-hidden', item.ariaHidden);
          item.element.style.pointerEvents = item.pointerEvents;
        }
      }
      const active = document.activeElement;
      if (previousFocus?.isConnected && (active === document.body || active === null || dialog.contains(active))) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return dialogRef;
}
