'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { ErrorNotice } from './error-notice';
import { Skeleton } from './skeleton';

/**
 * Estados de un segmento de rutas del App Router. Los archivos `loading.tsx`, `error.tsx` y `not-found.tsx` de
 * cada segmento son una línea que reexporta uno de estos, así el aspecto y los textos están en un solo lugar.
 */

/**
 * `loading.tsx`: esqueleto de una pantalla (título, filtros y tarjetas) mientras carga el segmento.
 * Aparece recién a los 250 ms: si la pantalla llega antes, no se ve un esqueleto que salta al de la pantalla.
 */
export function SegmentLoading() {
  const t = useTranslations('errors.segment');
  return (
    <div
      role="status"
      aria-busy="true"
      className="space-y-6 animate-[fade-in_0.2s_ease-out_0.25s_backwards] motion-reduce:animate-none"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-16 w-full rounded-[var(--radius-xl)]" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-[var(--radius-2xl)]" />
        ))}
      </div>
    </div>
  );
}

/** `error.tsx`: el segmento falló al mostrarse; ofrece reintentar o volver al panel. */
export function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.segment');
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-12">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">{t('errorTitle')}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('errorMessage')}</p>
      </div>
      <ErrorNotice error={error} />
      {error.digest && (
        <p className="text-xs text-[var(--color-muted)]">
          <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={reset}>
          {t('retry')}
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center rounded-lg border border-[var(--color-border)] px-5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)]"
        >
          {t('home')}
        </Link>
      </div>
    </div>
  );
}

/** `not-found.tsx`: el registro no existe o ya no está disponible. */
export function SegmentNotFound() {
  const t = useTranslations('errors.segment');
  return (
    <EmptyState
      iconName="search"
      title={t('notFoundTitle')}
      subtitle={t('notFoundMessage')}
      action={
        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center rounded-lg bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600"
        >
          {t('home')}
        </Link>
      }
    />
  );
}

/**
 * `not-found.tsx` fuera del panel (sitio público, portal, acceso): pantalla completa, sin navegación,
 * con un único camino de vuelta al inicio del sitio en el que está la persona.
 */
export function PageNotFound() {
  const t = useTranslations('errors.segment');
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <EmptyState
        iconName="search"
        title={t('pageNotFoundTitle')}
        subtitle={t('pageNotFoundMessage')}
        action={
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-lg bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600"
          >
            {t('pageHome')}
          </Link>
        }
      />
    </main>
  );
}

/** `error.tsx` fuera del panel: lo mismo que `SegmentError`, a pantalla completa. */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.segment');
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{t('errorTitle')}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('pageErrorMessage')}</p>
        </div>
        <ErrorNotice error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            {t('retry')}
          </Button>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-lg border border-[var(--color-border)] px-5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)]"
          >
            {t('pageHome')}
          </Link>
        </div>
      </div>
    </main>
  );
}
