'use client';

import { useTranslations } from 'next-intl';
import type { AccountsResponse } from '@/lib/cash';
import { cn } from '@/lib/cn';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  data: AccountsResponse | null;
  /** Falló la lectura de las cuentas: el aviso lo muestra la pantalla; acá no hay saldo que mostrar. */
  failed: boolean;
  onViewAccounts: () => void;
}

/** Saldo actual de la inmobiliaria por moneda, con lo propio y lo que guarda en custodia. */
export function CashBalance({ data, failed, onViewAccounts }: Props) {
  const t = useTranslations('cash');
  if (failed) return null;

  if (data === null) {
    return <Skeleton className="h-32 w-full rounded-xl" />;
  }

  if (data.totals.length === 0) {
    return (
      <section
        aria-label={t('balance.title')}
        className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-5"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">{t('balance.title')}</p>
        <p className="mt-2 font-mono text-3xl font-medium text-[var(--color-muted)] tabular-nums">
          <MoneyText value={0} currency="ARS" decimals={2} />
        </p>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">{t('balance.empty')}</p>
        <button
          type="button"
          onClick={onViewAccounts}
          className="mt-3 text-sm font-medium text-[var(--color-brand-600)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          {t('balance.viewAccounts')}
        </button>
      </section>
    );
  }

  return (
    <section aria-label={t('balance.title')} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="grid grid-cols-1 divide-y divide-[var(--color-border)] md:auto-cols-fr md:grid-flow-col md:divide-x md:divide-y-0">
        {data.totals.map((total, index) => (
          <div key={total.currency} className="p-5" aria-label={t('totals.label', { currency: total.currency })} role="group">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">
              {t('balance.inCurrency', { currency: total.currency })}
            </p>
            <p
              className={cn(
                'mt-2 break-words font-mono font-medium leading-tight tracking-tight tabular-nums',
                index === 0 ? 'text-[34px]' : 'text-[26px]',
                Number(total.total) < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]',
              )}
            >
              <MoneyText value={total.total} currency={total.currency} decimals={2} />
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--color-muted)]">
              <div className="flex gap-1.5">
                <dt>{t('totals.agency')}</dt>
                <dd className="font-mono text-[var(--color-text)] tabular-nums">
                  <MoneyText value={total.agency} currency={total.currency} decimals={2} />
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt>{t('totals.custody')}</dt>
                <dd className="font-mono text-[var(--color-text)] tabular-nums">
                  <MoneyText value={total.custody} currency={total.currency} decimals={2} />
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="border-t border-[var(--color-border)] px-5 py-2.5 text-xs text-[var(--color-muted)]">
        {data.custodyInAgencyBalance ? t('totals.includesCustody') : t('totals.excludesCustody')}
      </p>
    </section>
  );
}
