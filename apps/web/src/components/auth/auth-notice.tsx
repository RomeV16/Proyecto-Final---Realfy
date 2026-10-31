import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Aviso de las pantallas públicas: error o confirmación, con el mismo estilo que el ingreso. */
export function AuthNotice({
  tone,
  children,
}: {
  tone: 'danger' | 'success';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'text-sm rounded-lg px-4 py-3 border animate-[fade-in_0.4s_var(--ease-luxe)]',
        tone === 'danger'
          ? 'bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]'
          : 'bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-text)] border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]',
      )}
    >
      {children}
    </div>
  );
}
