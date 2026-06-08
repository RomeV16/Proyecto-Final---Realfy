import { cn } from '@/lib/cn';
import { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 border border-brand-500 hover:border-brand-600',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-bg)] active:bg-[var(--color-bg)] border border-[var(--color-border)]',
  ghost:
    'bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-bg)] active:bg-[var(--color-bg)] border border-transparent',
  danger:
    'bg-[var(--color-danger)] text-white hover:bg-red-700 active:bg-red-800 border border-[var(--color-danger)] hover:border-red-700',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
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
        'inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
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
