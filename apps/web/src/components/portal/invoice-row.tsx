'use client';

import { useTranslations } from 'next-intl';
import { EntityRow } from '@/components/ui/entity-card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Plate } from './portal-primitives';
import {
  INVOICE_TONE,
  addressOf,
  daysBetween,
  formatDate,
  formatMonthShort,
  formatMoney,
  formatPeriod,
  formatYearShort,
  invoiceState,
  todayUtcDay,
  toUtcDay,
  type PortalInvoice,
} from './portal-data';

/**
 * One invoice, as the tenant reads it: which month, how much, paid or not, and
 * by when. The PDF is the only action, and only on the invoice list — the
 * summary on the home screen links to the list instead of repeating a button
 * on every row.
 */
export function InvoiceRow({
  invoice,
  href,
  onDownload,
  downloading = false,
}: {
  invoice: PortalInvoice;
  href?: string;
  onDownload?: (invoice: PortalInvoice) => void;
  downloading?: boolean;
}) {
  const t = useTranslations();

  const today = todayUtcDay();
  const state = invoiceState(invoice, today);
  const tone = INVOICE_TONE[state];
  const period = formatPeriod(invoice.period);
  const due = toUtcDay(invoice.dueDate);
  const daysLate = state === 'overdue' && due !== null ? Math.max(0, daysBetween(due, today)) : 0;

  const dateLine =
    state === 'paid' && invoice.paidAt
      ? t('portal.invoices.paidOn', { date: formatDate(invoice.paidAt) })
      : invoice.dueDate
        ? t('portal.invoices.dueOn', { date: formatDate(invoice.dueDate) })
        : null;

  return (
    <EntityRow
      href={href}
      label={period}
      accent={state === 'overdue' ? 'danger' : state === 'due' ? 'warning' : 'none'}
      leading={
        <Plate tone={tone} size="md">
          <span className="text-[11px] font-semibold uppercase tracking-wide">
            {formatMonthShort(invoice.period)}
          </span>
          <span className="mt-0.5 text-[10px] opacity-70">{formatYearShort(invoice.period)}</span>
        </Plate>
      }
      title={period}
      subtitle={addressOf(invoice.contract?.property) ?? undefined}
      meta={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={tone} dot>
            {t(`portal.invoices.state.${state}` as Parameters<typeof t>[0])}
          </Badge>
          {dateLine && <span className="text-xs text-[var(--color-muted)]">{dateLine}</span>}
        </div>
      }
      trailing={
        <EntityRow.Amount
          value={formatMoney(invoice.total, invoice.currency ?? undefined)}
          hint={t('portal.invoices.total')}
          tone={state === 'overdue' ? 'danger' : state === 'paid' ? 'muted' : 'default'}
        />
      }
      actions={
        onDownload && (
          <EntityRow.Action
            variant="ghost"
            icon={downloading ? undefined : 'download'}
            onClick={() => onDownload(invoice)}
            disabled={downloading}
            aria-label={t('portal.invoices.downloadPdfFor', { period })}
          >
            {downloading && <Spinner className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{t('portal.invoices.pdf')}</span>
          </EntityRow.Action>
        )
      }
      alert={
        state === 'overdue' ? (
          <EntityRow.Alert tone="danger" icon="alert">
            {t('portal.invoices.overdueBy', { days: daysLate })}
          </EntityRow.Alert>
        ) : undefined
      }
    />
  );
}
