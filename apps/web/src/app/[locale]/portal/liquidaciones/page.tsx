'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { InvoiceRow } from '@/components/portal/invoice-row';
import { INVOICE_PAGE_SIZE, buildOverview, usePortalInvoices, type PortalInvoice } from '@/components/portal/portal-data';
import { formatDate, formatMoney, formatPeriod } from '@/lib/format';

/**
 * Invoices.
 *
 * The route keeps the API's name (`liquidaciones`) so existing links survive,
 * but everything the tenant reads says "factura" — one word for one thing.
 *
 * The list is deliberately flat: period, amount, state, due date. The PDF is
 * the only per-row action, because it is the document that carries the payment
 * details the tenant actually needs.
 */

export default function PortalInvoicesPage() {
  const t = useTranslations();
  const [limit, setLimit] = useState(INVOICE_PAGE_SIZE);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, isPending, isFetching, isError } = usePortalInvoices(limit);

  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const summary = useMemo(() => buildOverview([], items, []), [items]);
  const summaryTone = summary.state === 'clear' ? 'success' : summary.state === 'overdue' ? 'danger' : 'warning';

  /**
   * PDFs are rendered on demand and the endpoint is bearer-authenticated, so
   * the file has to be fetched and handed to the browser as a blob rather than
   * linked directly.
   */
  const handleDownload = async (invoice: PortalInvoice) => {
    setDownloadingId(invoice.id);
    try {
      await downloadFile(`/portal/liquidaciones/${invoice.id}/pdf`, `factura-${invoice.id}.pdf`, { portal: true });
    } catch {
      toast.error(t('common.downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  };

  if (isError) {
    return (
      <EmptyState iconName="alert" title={t('common.error')} subtitle={t('portal.common.error')} />
    );
  }

  return (
    <div>
      <header>
        <p className="eyebrow">{t('portal.common.brand')}</p>
        <h1 className="h2 mt-2">{t('portal.invoices.title')}</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">{t('portal.invoices.subtitle')}</p>
      </header>

      {/* Lo primero: cuánto hay que pagar y cuándo vence. Alto reservado para que la lista no salte. */}
      <div className="mb-5 mt-4 min-h-[4.5rem]">
        {!isPending && items.length > 0 && (
          <section
            aria-label={t('portal.account.label')}
            className="flex items-start gap-3 rounded-[var(--radius-xl)] border px-4 py-3"
            style={{
              borderColor: `color-mix(in oklab, var(--color-${summaryTone}) 28%, var(--color-border))`,
              backgroundColor: `color-mix(in oklab, var(--color-${summaryTone}) 8%, var(--color-surface))`,
            }}
          >
            <Icon
              name={summary.state === 'clear' ? 'check' : summary.state === 'overdue' ? 'alert' : 'calendarClock'}
              className="mt-1 h-5 w-5 shrink-0"
              strokeWidth={1.9}
              style={{ color: `var(--color-${summaryTone})` }}
            />
            <div className="min-w-0">
              <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">
                {summary.state === 'clear'
                  ? t('portal.account.clearTitle')
                  : formatMoney(summary.balance, summary.currency)}
              </p>
              <p className="text-sm text-[var(--color-muted)]">
                {summary.state === 'clear'
                  ? t('portal.account.clearDetail')
                  : summary.state === 'overdue'
                    ? t('portal.account.overdueDetail', { count: summary.overdueCount, days: summary.daysLate })
                    : t('portal.invoices.pendingSummary', { count: summary.pendingCount })}
              </p>
              {summary.focusInvoice && (
                <p className="mt-0.5 text-sm text-[var(--color-text)]">
                  {summary.state === 'overdue'
                    ? t('portal.account.focusOverdue', {
                        period: formatPeriod(summary.focusInvoice.period),
                        date: formatDate(summary.focusInvoice.dueDate),
                      })
                    : t('portal.account.focusDue', {
                        period: formatPeriod(summary.focusInvoice.period),
                        days: Math.max(0, summary.daysToDue ?? 0),
                      })}
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      <RowList
        items={items}
        loading={isPending}
        busy={isFetching && !isPending}
        skeletonCount={5}
        keyOf={(invoice) => invoice.id}
        renderItem={(invoice) => (
          <InvoiceRow
            invoice={invoice}
            onDownload={handleDownload}
            downloading={downloadingId === invoice.id}
          />
        )}
        empty={
          <EmptyState
            iconName="invoices"
            title={t('portal.invoices.empty')}
            subtitle={t('portal.invoices.emptySubtitle')}
          />
        }
      />

      {items.length < total && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => setLimit((current) => current + INVOICE_PAGE_SIZE)}
            disabled={isFetching}
          >
            {t('portal.invoices.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
