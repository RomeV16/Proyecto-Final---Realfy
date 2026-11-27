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
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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

/** Duración de la salida; coincide con la animación `dialog-out`. */
const EXIT_MS = 140;

function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
function useDialogContext() {
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

  /* Al cerrar, el panel queda montado lo que dura la salida, con el último contenido que tuvo abierto. */
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);
  const lastChildren = useRef<ReactNode>(children);
  if (open) lastChildren.current = children;

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setClosing(false);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (!motionAllowed()) return;
    setClosing(true);
    const timer = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

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

  if ((!open && !closing) || typeof document === 'undefined') return null;

  /* Se dibuja en el body: así `fixed` siempre es relativo a la ventana, aunque algún
     contenedor de la página tenga transform o filter. */
  return createPortal(
    <DialogContext.Provider value={{ titleId, busy, onClose }}>
      <div
        className={cn(
          'fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4',
          !open && 'pointer-events-none',
        )}
      >
        {/* Backdrop */}
        <div
          className={cn(
            'absolute inset-0 bg-black/50',
            open ? 'animate-[overlay-in_0.18s_ease-out]' : 'animate-[overlay-out_0.14s_ease-in_forwards]',
          )}
          onClick={() => {
            if (open && closeOnOverlayClick && !busy) onClose();
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
            'relative z-10 flex w-full flex-col overflow-y-auto bg-[var(--color-surface)] shadow-xl outline-none',
            /* Un <form> que envuelve cabecera, cuerpo y pie sigue la misma columna: se desplaza solo el cuerpo. */
            '[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col',
            'max-h-[calc(100dvh-1rem)] rounded-t-lg sm:max-h-[calc(100dvh-2rem)] sm:rounded-lg',
            SIZE_CLASS[size],
            open
              ? 'animate-[dialog-in_0.2s_cubic-bezier(0.16,1,0.3,1)]'
              : 'animate-[dialog-out_0.14s_ease-in_forwards]',
            className,
          )}
        >
          {open ? children : lastChildren.current}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  );
}

export function DialogHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ctx = useDialogContext();
  return (
    <div
      id={ctx?.titleId}
      className={cn('shrink-0 px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function DialogFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shrink-0 px-6 py-4 border-t border-[var(--color-border)] flex items-center justify-end gap-3', className)}
      {...props}
    >
      {children}
    </div>
  );
}
