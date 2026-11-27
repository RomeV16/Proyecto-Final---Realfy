'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';

/**
 * Cubre la pantalla mientras se cierra la sesión. La interfaz queda quieta debajo, con los datos
 * que tenía, hasta que el navegador abre la pantalla de ingreso: sin esto se veía el panel vacío
 * (sin nombre ni menú) durante la espera.
 */
export function SessionExitCover() {
  const t = useTranslations('common');
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 bg-[var(--color-bg)] animate-[fade-in_0.18s_ease-out]"
    >
      <div className="flex items-center gap-2.5" aria-hidden="true">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 font-display text-lg italic text-white">
          R
        </span>
        <span className="wordmark text-[1.35rem]">Realfy</span>
      </div>
      <Spinner className="h-5 w-5 text-brand-500" />
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}
