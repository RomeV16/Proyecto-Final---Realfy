import { cn } from '@/lib/cn';
import { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 border border-brand-500 hover:border-brand-600 shadow-[0_1px_2px_rgb(45_33_20/0.15)] hover:shadow-[0_10px_24px_-12px_rgb(189_90_50/0.55)]',
  accent:
    'bg-[var(--color-accent-500)] text-white hover:bg-[var(--color-accent-600)] border border-[var(--color-accent-500)] shadow-[0_1px_2px_rgb(45_33_20/0.15)] hover:shadow-[0_10px_24px_-12px_rgb(61_95_73/0.5)]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] active:bg-[var(--color-surface-sunken)] border border-[var(--color-border)] hover:border-[var(--color-slate-400)]',
  ghost:
    'bg-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] border border-transparent',
  danger:
    'bg-[var(--color-danger)] text-white hover:brightness-110 active:brightness-95 border border-[var(--color-danger)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-md',
  md: 'h-11 px-5 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-7 text-base gap-2.5 rounded-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'group relative inline-flex items-center justify-center font-medium tracking-tight whitespace-nowrap cursor-pointer',
        'transition-all duration-300 [transition-timing-function:var(--ease-luxe)]',
        'hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.985]',
        'focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
