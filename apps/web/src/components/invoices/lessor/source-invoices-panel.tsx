'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { comprobanteNumber, jobPersonName, type SourceComprobante, type SourceInvoices } from '@/lib/lessor-invoicing';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useErrorText } from '@/components/cash/use-cash-data';

interface Props {
  sourceType: 'Payment' | 'OwnerStatement';
  sourceId: string;
  /** Falso si todavía no se puede facturar (por ejemplo, un estado en borrador). */
  canInvoice?: boolean;
}

const PATH = { Payment: 'payments', OwnerStatement: 'owner-statements' } as const;

/**
 * Facturas emitidas por cuenta del locador por un cobro o un estado de cuenta, la cola de emisión de
 * ese origen y la acción de facturar. Facturar es idempotente: repetirlo no emite otra factura.
 */
export function SourceInvoicesPanel({ sourceType, sourceId, canInvoice = true }: Props) {
  const t = useTranslations('lessorInvoicing');
  const errorText = useErrorText();
  const canView = useCan('lessorInvoicing.view');
  const canEmit = useCan('lessorInvoicing.emit');
  const [data, setData] = useState<SourceInvoices | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const base = `/${PATH[sourceType]}/${sourceId}/invoices`;

  const load = useCallback(async () => {
    try {
      setData(await apiClient<SourceInvoices>(base));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  if (!canView) return null;
  if (error != null && !data) return <ErrorNotice error={error} fallback={t('source.loadError')} />;
  if (!data) return <Skeleton className="h-24 w-full" />;

  async function invoice() {
    setBusy(true);
    try {
      const out = await apiClient<{ results: { status: string }[] }>(base, { method: 'POST' });
      toast.success(out.results.length === 0 ? t('source.nobody') : t('source.invoiced'));
    } catch (err) {
      toast.error(errorText(err, t('source.invoiceError')));
    } finally {
      setBusy(false);
      await load();
    }
  }

  const invoiced = data.comprobantes.length > 0;
  const columns = (c: SourceComprobante) => (
    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span>
        <Link href={`/invoices/${c.id}`} className="font-medium text-[var(--color-brand-600)] hover:underline">
          {t(`comprobanteTypes.${c.type}`)} {comprobanteNumber(c)}
        </Link>
        <span className="ml-2 text-[var(--color-muted)]">
          {c.issuer.businessName} · {formatDate(c.emittedAt)}
        </span>
        {c.creditNotes.length > 0 && <span className="ml-2 text-xs text-[var(--color-danger)]">{t('source.credited')}</span>}
      </span>
      <MoneyText value={c.impTotal} currency={c.currency} decimals={2} className="tabular-nums" />
    </li>
  );

  return (
    <section aria-label={t('source.title')} className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('source.title')}</h2>
          <p className="text-sm text-[var(--color-muted)]">{t('source.explain')}</p>
        </div>
        {canEmit && canInvoice && (
          <Button type="button" disabled={busy} onClick={() => void invoice()}>
            {invoiced ? t('source.retry') : t('source.invoice')}
          </Button>
        )}
      </div>
      {!canInvoice && <p className="text-sm italic text-[var(--color-muted)]">{t('source.notReady')}</p>}
      {data.comprobantes.length === 0 ? (
        <p className="text-sm italic text-[var(--color-muted)]">{t('source.none')}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">{data.comprobantes.map(columns)}</ul>
      )}
      {data.jobs.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={t('source.jobs')}>
          {data.jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2">
              <StatusBadge domain="facturaLocador" status={j.status} />
              <span>
                {t(`kinds.${j.kind}`)} · {jobPersonName(j)}
              </span>
              {j.lastError && j.status !== 'Emitido' && <span className="text-xs text-[var(--color-danger)]">{j.lastError}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
