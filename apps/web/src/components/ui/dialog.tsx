'use client';

import { cn } from '@/lib/cn';
import { HTMLAttributes, ReactNode, useEffect } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel — TODO(D5-D11): add focus trap */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 w-full max-w-lg mx-4 bg-[var(--color-surface)] rounded-lg shadow-xl',
          'animate-[zoom-in_0.2s_cubic-bezier(0.16,1,0.3,1)]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
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
