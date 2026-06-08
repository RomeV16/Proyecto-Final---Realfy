import { cn } from '@/lib/cn';
import { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-[var(--color-text)]"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'h-10 w-full rounded-md border px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)]',
          'placeholder:text-[var(--color-muted)]',
          'transition-colors duration-150',
          'focus:outline-2 focus:outline-brand-500 focus:outline-offset-0',
          error
            ? 'border-[var(--color-danger)] focus:outline-[var(--color-danger)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-muted)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}-hint`} className="text-xs text-[var(--color-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
