import { cn } from '@/lib/cn';
import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, subtitle, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 px-6 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-bg)] text-[var(--color-muted)]">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="h3">{title}</p>
        {subtitle && (
          <p className="text-sm text-[var(--color-muted)] max-w-xs">{subtitle}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
