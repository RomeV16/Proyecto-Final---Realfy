'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/cn';

export type ArcaEnvironment = 'production' | 'testing' | 'unknown';

/**
 * Contra qué ambiente de ARCA emite la inmobiliaria, según su certificado. Solo un administrador puede leerlo: para
 * los demás roles (o sin certificado) queda en `unknown` y no se muestra nada.
 */
export function useArcaEnvironment(): ArcaEnvironment {
  const [environment, setEnvironment] = useState<ArcaEnvironment>('unknown');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cert = await apiClient<{ isProduction?: boolean } | null>('/invoices/certificate');
        if (!cancelled && cert && typeof cert.isProduction === 'boolean') {
          setEnvironment(cert.isProduction ? 'production' : 'testing');
        }
      } catch {
        // sin permiso o sin certificado: no se sabe el ambiente
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return environment;
}

/** Franja que avisa que se opera contra homologación: lo emitido es de prueba y no vale ante ARCA. */
export function TestingNotice({ environment, className }: { environment: ArcaEnvironment; className?: string }) {
  const t = useTranslations('invoices.environment');
  if (environment !== 'testing') return null;
  return (
    <div
      role="note"
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-dashed px-4 py-2.5 text-sm',
        'border-[color-mix(in_oklab,var(--color-warning)_55%,var(--color-border))]',
        'bg-[color-mix(in_oklab,var(--color-warning)_10%,var(--color-surface))] text-[var(--color-text)]',
        className,
      )}
    >
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[color-mix(in_oklab,var(--color-warning)_70%,var(--color-text))]">
        {t('testingTag')}
      </span>
      <span>{t('testingBody')}</span>
    </div>
  );
}
