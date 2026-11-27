import { cn } from '@/lib/cn';
import { ReactNode } from 'react';
import { Icon, type IconName } from './icon';

interface EmptyStateProps {
  /** Legacy slot — a raw node rendered in the icon plate. */
  icon?: ReactNode;
  /** Preferred: name from the icon registry, rendered in the icon plate. */
  iconName?: IconName;
  title: string;
  subtitle?: string;
  /** Numbered getting-started steps. Turns a dead end into an onboarding moment. */
  steps?: string[];
  /** Primary call to action. */
  action?: ReactNode;
  /** Secondary action — "limpiar filtros", "ver ayuda". */
  secondaryAction?: ReactNode;
  /**
   * `filtered` is the "your filters matched nothing" case: smaller, no
   * onboarding framing, since the list itself isn't actually empty.
   */
  variant?: 'default' | 'filtered';
  className?: string;
}

/**
 * Empty state.
 *
 * An empty list is the moment a user is most likely to bounce, so this is
 * treated as a real screen rather than a shrug: a quiet icon plate, one clear
 * next action, and optional numbered steps for first-run screens.
 */
export function EmptyState({
  icon,
  iconName,
  title,
  subtitle,
  steps,
  action,
  secondaryAction,
  variant = 'default',
  className,
}: EmptyStateProps) {
  const filtered = variant === 'filtered';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        filtered ? 'gap-3 py-12' : 'gap-4 py-16',
        className,
      )}
    >
      {(iconName || icon) && (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-[var(--color-muted)]',
            filtered ? 'h-12 w-12' : 'h-14 w-14',
          )}
        >
          {iconName ? (
            <Icon name={iconName} className={filtered ? 'h-5 w-5' : 'h-6 w-6'} strokeWidth={1.6} />
          ) : (
            icon
          )}
        </div>
      )}

      <div className="flex max-w-md flex-col gap-1.5">
        <p className={filtered ? 'h4' : 'h3'}>{title}</p>
        {subtitle && <p className="text-sm leading-relaxed text-[var(--color-muted)]">{subtitle}</p>}
      </div>

      {steps && steps.length > 0 && (
        <ol className="mt-1 max-w-md space-y-2 text-left">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-text)]">
              <span
                className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[var(--color-brand-700)]"
                style={{
                  backgroundColor:
                    'color-mix(in oklab, var(--color-brand-500) 14%, var(--color-surface))',
                }}
              >
                {i + 1}
              </span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
