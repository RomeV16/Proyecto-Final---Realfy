'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ReadResource } from '@realfy/shared';
import { useCanRead } from '@/lib/permissions';

interface ReadGateProps {
  resource: ReadResource;
  children: ReactNode;
  /** Qué se muestra sin acceso; por defecto, un aviso breve. */
  fallback?: ReactNode;
}

/**
 * Muestra el contenido solo si la política de lectura de la inmobiliaria deja
 * leer el recurso al rol del usuario; si no, un aviso de "sin acceso". La API
 * niega o enmascara el dato de todos modos: esto evita secciones vacías.
 */
export function ReadGate({ resource, children, fallback }: ReadGateProps) {
  const t = useTranslations('readGate');
  const allowed = useCanRead(resource);
  if (allowed) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <div role="note" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
          <p className="font-medium text-[var(--color-text)]">{t('title')}</p>
          <p className="mt-0.5 text-[var(--color-muted)]">{t('body')}</p>
        </div>
      )}
    </>
  );
}
