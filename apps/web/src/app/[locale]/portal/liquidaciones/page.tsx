'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getPortalAccessToken } from '@/lib/portal-api-client';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { InvoiceRow } from '@/components/portal/invoice-row';
import {
  INVOICE_PAGE_SIZE,
  buildOverview,
  formatMoney,
  usePortalInvoices,
  type PortalInvoice,
} from '@/components/portal/portal-data';

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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export default function PortalInvoicesPage() {
  const t = useTranslations();
  const [limit, setLimit] = useState(INVOICE_PAGE_SIZE);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, isPending, isFetching, isError } = usePortalInvoices(limit);

  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const summary = useMemo(() => buildOverview([], items, []), [items]);

  /**
   * PDFs are rendered on demand and the endpoint is bearer-authenticated, so
   * the file has to be fetched and handed to the browser as a blob rather than
   * linked directly.
   */
  const handleDownload = async (invoice: PortalInvoice) => {
    setDownloadingId(invoice.id);
    try {
      const token = getPortalAccessToken();
      const res = await fetch(`${API_BASE_URL}/portal/liquidaciones/${invoice.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${invoice.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Silent failure — user can retry.
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

      {/* Height reserved so the list doesn't jump once the balance is known. */}
      <div className="mb-5 mt-4 min-h-[2.25rem]">
        {summary.balance > 0 && (
          <p
            className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-lg)] border px-3 py-1.5 text-sm"
            style={{
              borderColor: `color-mix(in oklab, var(--color-${summary.state === 'overdue' ? 'danger' : 'warning'}) 28%, var(--color-border))`,
              backgroundColor: `color-mix(in oklab, var(--color-${summary.state === 'overdue' ? 'danger' : 'warning'}) 10%, var(--color-surface))`,
            }}
          >
            <Icon name="wallet" className="h-4 w-4 shrink-0" strokeWidth={1.9} />
            <strong className="font-semibold tabular-nums">
              {formatMoney(summary.balance, summary.currency)}
            </strong>
            <span className="text-[var(--color-muted)]">
              {t('portal.invoices.pendingSummary', {
                count: summary.overdueCount + summary.pendingCount,
              })}
            </span>
          </p>
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
