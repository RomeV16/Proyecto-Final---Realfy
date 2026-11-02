'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Aviso de que las rendiciones por contrato son histórico: las reemplazan la cuenta corriente y el estado de cuenta. */
export function RenditionsHistoricalNotice() {
  const t = useTranslations('renditions.historical');
  return (
    <div role="note" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4 text-sm">
      <p className="font-medium text-[var(--color-text)]">{t('title')}</p>
      <p className="mt-0.5 text-[var(--color-muted)]">{t('body')}</p>
      <p className="mt-2 flex flex-wrap gap-4">
        <Link href="/estados-de-cuenta" className="font-medium text-[var(--color-brand-600)] hover:underline">
          {t('statements')}
        </Link>
        <Link href="/locadores" className="font-medium text-[var(--color-brand-600)] hover:underline">
          {t('owners')}
        </Link>
      </p>
    </div>
  );
}
