'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { RendicionStatus, RendicionLineItemType } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import { formatMoneyFixed, formatLocalDate } from '@/lib/format';
import { RenditionsHistoricalNotice } from './historical-notice';
import {
  BreakdownBar,
  renditionBreakdown,
  renditionNumber,
  renditionOwnerName,
  renditionPeriodLabel,
  type RenditionSummary,
} from './rendition-voucher';

/* ──────────── Types ──────────── */

interface LineItem {
  id: string;
  type: RendicionLineItemType;
  description: string;
  amount: string | number;
  isDebit: boolean;
}

interface RenditionDetail extends RenditionSummary {
  commissionAmount: string | number;
  adminFeeAmount: string | number;
  deductionTotal: string | number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: LineItem[];
}

interface RenditionDetailProps {
  renditionId: string;
}

const MINUS = '−';

/* ──────────── Main Component ──────────── */

export function RenditionDetail({ renditionId }: RenditionDetailProps) {
  const t = useTranslations('renditions');
  const tDoc = useTranslations('renditions.document');
  const tMonths = useTranslations('renditions.months');
  const tVoucher = useTranslations('renditions.voucher');
  const tLineItemTypes = useTranslations('renditions.lineItemTypes');
  const tCommon = useTranslations('common');

  const [rendition, setRendition] = useState<RenditionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRendition = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<RenditionDetail>(`/renditions/${renditionId}`);
      setRendition(data);
    } catch {
      setRendition(null);
    } finally {
      setLoading(false);
    }
  }, [renditionId]);

  useEffect(() => {
    void fetchRendition();
  }, [fetchRendition]);

  async function handleDownloadPdf() {
    if (!rendition) return;
    try {
      await downloadFile(`/renditions/${rendition.id}/pdf`, `rendicion-${rendition.id}.pdf`);
    } catch {
      toast.error(tCommon('downloadFailed'));
    }
  }

  /* ──── Loading / Error States ──── */

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="mx-auto max-w-3xl space-y-4">
        <span className="sr-only">{tCommon('loading')}</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-[28rem] w-full rounded-[var(--radius-xl)]" />
      </div>
    );
  }

  if (!rendition) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{t('errors.notFound')}</h2>
        <Link href={'/renditions'} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
          <Icon name="arrowLeft" className="h-4 w-4" />
          {tDoc('back')}
        </Link>
      </div>
    );
  }

  const periodLabel = renditionPeriodLabel(rendition, (m) => tMonths(String(m) as '1'));
  const ownerName = renditionOwnerName(rendition);
  const property = rendition.contract?.property;
  const address = property ? [[property.street, property.number].filter(Boolean).join(' '), property.city].filter(Boolean).join(', ') : '';
  const breakdown = renditionBreakdown(rendition);
  const money = (value: string | number) => formatMoneyFixed(value, rendition.currency);
  const deposited = rendition.status === RendicionStatus.Depositada;

  const calculation = [
    { key: 'commission', label: t('summary.commission'), value: Number(rendition.commissionAmount), always: true },
    { key: 'adminFee', label: t('summary.adminFee'), value: Number(rendition.adminFeeAmount), always: false },
    { key: 'deductions', label: t('summary.deductions'), value: Number(rendition.deductionTotal), always: false },
  ].filter((row) => row.always || row.value > 0);

  const steps = [
    { key: 'created', label: tDoc('created'), at: rendition.createdAt },
    { key: 'sent', label: tDoc('sent'), at: rendition.sentAt },
    { key: 'deposited', label: tDoc('deposited'), at: rendition.depositedAt },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={'/renditions'} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
          <Icon name="arrowLeft" className="h-4 w-4" />
          {tDoc('back')}
        </Link>
        <Button variant="secondary" size="sm" onClick={() => void handleDownloadPdf()}>
          <Icon name="download" className="h-4 w-4" strokeWidth={2} />
          {t('pdf.download')}
        </Button>
      </div>

      <RenditionsHistoricalNotice />

      <article className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Encabezado del comprobante */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-5 sm:px-8">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{t('detail.title')}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--color-text)]">{periodLabel}</h1>
          </div>
          <div className="text-right">
            <p className="font-mono text-xs tabular-nums text-[var(--color-muted)]">
              {tVoucher('number', { number: renditionNumber(rendition.id) })}
            </p>
            <StatusBadge domain="rendicion" status={rendition.status} size="md" className="mt-1.5" />
          </div>
        </header>

        {/* Partes */}
        <dl className="grid gap-4 border-b border-[var(--color-border)] px-5 py-4 sm:grid-cols-2 sm:px-8">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{t('detail.owner')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{ownerName ?? t('card.noOwner')}</dd>
            {rendition.owner?.cuit && (
              <dd className="font-mono text-xs tabular-nums text-[var(--color-muted)]">{tDoc('cuit', { cuit: rendition.owner.cuit })}</dd>
            )}
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{t('detail.property')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{property?.title ?? t('card.noProperty')}</dd>
            {address && <dd className="text-xs text-[var(--color-muted)]">{address}</dd>}
            {rendition.contract && (
              <dd className="mt-1">
                <Link href={`/contracts/${rendition.contract.id}`} className="text-xs font-medium text-[var(--color-brand-600)] hover:underline">
                  {t('detail.viewContract')}
                </Link>
              </dd>
            )}
          </div>
        </dl>

        {/* Conceptos */}
        <section className="border-b border-[var(--color-border)] px-5 py-4 sm:px-8">
          <h2 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{t('lineItems.title')}</h2>
          {(rendition.lineItems || []).length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">{t('lineItems.empty')}</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>{tDoc('concept')}</th>
                  <th>{t('lineItems.type')}</th>
                  <th>{t('lineItems.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {(rendition.lineItems || []).map((li) => (
                  <tr key={li.id}>
                    <td className="py-2 pr-3 text-[var(--color-text)]">{li.description}</td>
                    <td className="hidden py-2 pr-3 text-xs text-[var(--color-muted)] sm:table-cell">{tLineItemTypes(li.type)}</td>
                    <td
                      className={cn(
                        'whitespace-nowrap py-2 text-right font-mono tabular-nums',
                        li.isDebit ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]',
                      )}
                    >
                      {li.isDebit ? `${MINUS} ` : ''}
                      {money(li.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* La cuenta: cobrado − honorarios − gastos = neto */}
        <section className="px-5 py-5 sm:px-8">
          <h2 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{t('summary.title')}</h2>
          <dl className="mt-2 space-y-1.5 sm:ml-auto sm:max-w-sm">
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="text-[var(--color-text)]">{t('summary.rentCollected')}</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)]">{money(rendition.rentCollected)}</dd>
            </div>
            {calculation.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-[var(--color-muted)]">{row.label}</dt>
                <dd className="font-mono tabular-nums text-[var(--color-muted)]">
                  {MINUS} {money(row.value)}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t-2 border-[var(--color-text)] pt-2">
              <dt className="text-sm font-semibold text-[var(--color-text)]">
                {deposited ? tVoucher('netPaid') : t('summary.netDeposit')}
              </dt>
              <dd className="font-mono text-xl font-semibold tabular-nums text-[var(--color-text)]">{money(rendition.netDeposit)}</dd>
            </div>
            <BreakdownBar
              breakdown={breakdown}
              label={tVoucher('barLabel', { net: money(breakdown.net), collected: money(breakdown.collected) })}
              className="mt-2"
            />
          </dl>
        </section>

        {rendition.notes && (
          <section className="border-t border-[var(--color-border)] px-5 py-4 sm:px-8">
            <h2 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{t('notes.title')}</h2>
            <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-text)]">{rendition.notes}</p>
          </section>
        )}

        {/* Seguimiento */}
        <footer className="border-t border-dashed border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-5 py-4 sm:px-8">
          <h2 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{tDoc('timeline')}</h2>
          <ol className="mt-2 grid gap-2 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    step.at
                      ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]',
                  )}
                >
                  {step.at && <Icon name="check" className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <div>
                  <p className={cn('text-sm', step.at ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]')}>{step.label}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {step.at ? formatLocalDate(step.at, 'long') : tDoc('pendingStep')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </footer>
      </article>
    </div>
  );
}
