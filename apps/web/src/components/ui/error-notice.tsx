'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiRequestError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { Icon } from './icon';

interface ErrorNoticeProps {
  /** Lo que se capturó: un `ApiRequestError`, cualquier `Error`, un texto o nada reconocible. */
  error: unknown;
  /** Texto propio para errores que no vienen de la API (reemplaza el genérico). */
  fallback?: string;
  className?: string;
}

/**
 * Aviso de un error de la API. Muestra el mensaje, el código del error y la
 * referencia de correlación con un botón para copiarla (es lo que se le pide
 * al usuario cuando reporta el problema). Se anuncia como `role="alert"`.
 *
 * El mensaje es el que devolvió la API, salvo que `errors.codes.<errorCode>`
 * tenga una versión localizada (errores genéricos como `INTERNAL_ERROR`).
 */
export function ErrorNotice({ error, fallback, className }: ErrorNoticeProps) {
  const t = useTranslations('errors');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = error instanceof ApiRequestError ? error : null;
  const localized = api?.errorCode && t.has(`codes.${api.errorCode}`) ? t(`codes.${api.errorCode}`) : null;
  const base = localized ?? (error instanceof Error ? error.message : typeof error === 'string' ? error : '');
  const text = (api ? base : fallback || base) || t('generic');
  const correlationId = api?.correlationId;

  async function copyReference() {
    if (!correlationId) return;
    try {
      await navigator.clipboard.writeText(correlationId);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-lg border p-3 text-sm',
        'border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))]',
        'bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))]',
        'text-[color-mix(in_oklab,var(--color-danger)_72%,var(--color-text))]',
        className,
      )}
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>{text}</p>
        {api && (api.errorCode || correlationId) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-80">
            {api.errorCode && (
              <span>
                {t('code')}: <code className="font-mono">{api.errorCode}</code>
              </span>
            )}
            {correlationId && (
              <span className="inline-flex items-center gap-1.5">
                {t('reference')}: <code className="font-mono break-all">{correlationId}</code>
                <button
                  type="button"
                  onClick={copyReference}
                  className="rounded border border-current/30 px-1.5 py-0.5 text-[11px] font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-1"
                >
                  {copied ? t('copied') : t('copyReference')}
                </button>
                <span className="sr-only" aria-live="polite">
                  {copied ? t('copied') : ''}
                </span>
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
