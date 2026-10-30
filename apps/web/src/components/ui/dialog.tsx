'use client';

import { cn } from '@/lib/cn';
import {
  HTMLAttributes,
  ReactNode,
  RefObject,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
} from 'react';

type DialogSize = 'sm' | 'md' | 'lg';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Ancho del panel. */
  size?: DialogSize;
  /** Mientras es true no se puede cerrar (Esc, fondo ni botón de cierre). */
  busy?: boolean;
  /** Si es false, el clic en el fondo no cierra. */
  closeOnOverlayClick?: boolean;
  /** Elemento que recibe el foco al abrir; por defecto el primer enfocable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Id del elemento que describe el diálogo. */
  describedBy?: string;
}

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* Pila de diálogos abiertos: solo el último reacciona al teclado. */
const dialogStack: symbol[] = [];

/* Bloqueo de scroll del body con contador, seguro al apilar. */
let scrollLocks = 0;
let savedOverflow = '';

function lockScroll() {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

const DialogContext = createContext<{ titleId: string; busy: boolean; onClose: () => void } | null>(null);

/** Estado del diálogo actual, para botones de cierre propios. */
export function useDialogContext() {
  return useContext(DialogContext);
}

export function Dialog({
  open,
  onClose,
  children,
  className,
  size = 'md',
  busy = false,
  closeOnOverlayClick = true,
  initialFocusRef,
  describedBy,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    if (!open) return;
    const token = Symbol('dialog');
    dialogStack.push(token);
    lockScroll();
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const target = initialFocusRef?.current ?? focusableIn(panel)[0] ?? panel;
      target.focus();
    }

    const handler = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        if (latest.current.busy) return;
        e.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = focusableIn(panelRef.current);
      if (items.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panelRef.current.contains(active);
      if (e.shiftKey && (active === first || active === panelRef.current || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);

    return () => {
      document.removeEventListener('keydown', handler);
      const i = dialogStack.indexOf(token);
      if (i >= 0) dialogStack.splice(i, 1);
      unlockScroll();
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // initialFocusRef es un ref estable; el foco inicial solo se calcula al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <DialogContext.Provider value={{ titleId, busy, onClose }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 transition-opacity duration-150"
          onClick={() => {
            if (closeOnOverlayClick && !busy) onClose();
          }}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={describedBy}
          aria-busy={busy || undefined}
          tabIndex={-1}
          className={cn(
            'relative z-10 w-full mx-4 bg-[var(--color-surface)] rounded-lg shadow-xl outline-none',
            SIZE_CLASS[size],
            'animate-[zoom-in_0.2s_cubic-bezier(0.16,1,0.3,1)]',
            className,
          )}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>
  );
}

export function DialogHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ctx = useDialogContext();
  return (
    <div
      id={ctx?.titleId}
      className={cn('px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-6 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function DialogFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-6 py-4 border-t border-[var(--color-border)] flex items-center justify-end gap-3', className)}
      {...props}
    >
      {children}
    </div>
  );
}
