'use client';

import { type ReactNode, type FormEvent, type HTMLAttributes, useRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/spinner';

/* ──────────── Section subcomponent ──────────── */

interface SectionProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

function Section({ title, description, children, className, ...rest }: SectionProps) {
  return (
    <section
      className={cn(
        'bg-white rounded-xl border border-slate-200 p-5 w-full',
        className,
      )}
      {...rest}
    >
      {(title || description) && (
        <div className="mb-4 pb-3 border-b border-slate-100">
          {title && (
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          )}
          {description && (
            <p className="text-sm text-muted mt-0.5 text-slate-500">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/* ──────────── Main FormShell component ──────────── */

interface SecondaryAction {
  label: string;
  onClick: () => void;
}

interface FormShellProps {
  title?: string;
  subtitle?: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  submitBusy?: boolean;
  secondaryAction?: SecondaryAction;
  children: ReactNode;
  className?: string;
}

export function FormShell({
  title,
  subtitle,
  onSubmit,
  submitLabel,
  submitBusy = false,
  secondaryAction,
  children,
  className,
}: FormShellProps) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Focus first invalid field for accessibility
    if (formRef.current) {
      const invalid = formRef.current.querySelector<HTMLElement>(
        'input:invalid, select:invalid, textarea:invalid',
      );
      if (invalid) {
        invalid.focus();
        return;
      }
    }
    onSubmit(e);
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className={cn('w-full max-w-2xl', className)}
      noValidate
    >
      {/* Optional form-level header */}
      {(title || subtitle) && (
        <div className="mb-6">
          {title && (
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          )}
        </div>
      )}

      {/* Sections */}
      <div className="space-y-6">{children}</div>

      {/* Sticky submit bar — fixed on mobile, inline on sm+ */}
      <div
        className={cn(
          'sticky bottom-0 z-10',
          'bg-[var(--color-surface,#fff)] border-t border-slate-200',
          'py-3 px-1 mt-6',
          'flex flex-row-reverse gap-3',
          // On desktop treat it as a normal footer (not visually "sticky bar")
          'sm:static sm:border-t-0 sm:bg-transparent sm:mt-2 sm:px-0',
        )}
      >
        <button
          type="submit"
          disabled={submitBusy}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {submitBusy && <Spinner className="w-4 h-4 text-white" />}
          {submitLabel}
        </button>
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="px-6 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </form>
  );
}

FormShell.Section = Section;
