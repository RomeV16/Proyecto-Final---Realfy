import type { ReactNode } from 'react';

/** Confirmación de las pantallas públicas de acceso (los errores van con `ErrorNotice`). */
export function AuthSuccess({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="text-sm rounded-lg px-4 py-3 border animate-[fade-in_0.4s_var(--ease-luxe)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-text)] border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]"
    >
      {children}
    </div>
  );
}
