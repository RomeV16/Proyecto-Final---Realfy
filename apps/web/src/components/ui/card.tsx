import { cn } from '@/lib/cn';
import { HTMLAttributes } from 'react';

type DivProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: DivProps) {
  return (
    <div
      className={cn('px-6 py-4 border-b border-[var(--color-border)]', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ className, children, ...props }: DivProps) {
  return (
    <div className={cn('px-6 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)] rounded-b-[var(--radius-xl)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
