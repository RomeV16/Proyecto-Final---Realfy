'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface TabsProps<K extends string> {
  tabs: readonly K[];
  value: K;
  onChange: (tab: K) => void;
  /** Nombre accesible de la lista de solapas. */
  label: string;
  /** Texto de cada solapa. */
  labelOf: (tab: K) => string;
  /** Contenido de la solapa elegida. */
  children: ReactNode;
}

/** Solapas de una pantalla: la lista de botones y el panel de la elegida. */
export function Tabs<K extends string>({ tabs, value, onChange, label, labelOf, children }: TabsProps<K>) {
  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1"
      >
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key)}
            className={cn(
              'whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              value === key
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {labelOf(key)}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={labelOf(value)}>
        {children}
      </div>
    </>
  );
}
