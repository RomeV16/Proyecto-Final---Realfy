import { cn } from '@/lib/cn';
import { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Clases de un control de texto (input, select, textarea): una sola cadena de
 * foco, borde y estado inválido para todos. `multiline` cambia la altura fija
 * por una mínima con relleno vertical.
 */
export function inputStyles({
  invalid = false,
  multiline = false,
  className,
}: {
  invalid?: boolean;
  multiline?: boolean;
  className?: string;
} = {}): string {
  return cn(
    multiline ? 'min-h-[5.5rem] py-2.5' : 'h-11',
    'w-full rounded-lg border px-3.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)]',
    'placeholder:text-[var(--color-muted)]',
    'transition-[border-color,box-shadow] duration-300 [transition-timing-function:var(--ease-luxe)]',
    'focus:outline-none focus:ring-4',
    invalid
      ? 'border-[var(--color-danger)] focus:ring-[color-mix(in_srgb,var(--color-danger)_18%,transparent)]'
      : 'border-[var(--color-border)] hover:border-[var(--color-slate-400)] focus:border-brand-500 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    className,
  );
}

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[0.8rem] font-medium text-[var(--color-text)]"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={inputStyles({ invalid: !!error || props['aria-invalid'] === true || props['aria-invalid'] === 'true', className })}
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
