'use client';

import { cn } from '@/lib/cn';

interface NavCountBadgeProps {
  count: number;
  /** Texto para lectores de pantalla ("3 consultas sin leer"). */
  label: string;
  /** Se pinta de rojo (hay algo vencido). */
  danger?: boolean;
  /** Se apoya sobre el ícono (menú colapsado y barra de íconos). */
  floating?: boolean;
}

/** Contador a la derecha de un ítem del menú; no se muestra en cero. */
export function NavCountBadge({ count, label, danger = false, floating = false }: NavCountBadgeProps) {
  if (count === 0) return null;
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[0.65rem] font-semibold leading-5 tabular-nums text-white',
        danger ? 'bg-[var(--color-danger)]' : 'bg-brand-500',
        floating && 'absolute -right-1 -top-1',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
