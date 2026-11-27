'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoneyFixed, formatDate, formatLocalDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import type { ArcaIssuerDTO } from '@/lib/schemas/invoices';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useArcaEnvironment } from './arca-environment';
import {
  formatDocNumber,
  isCreditNote,
  isInvoice,
  voucherCode,
  voucherLetter,
  voucherNumber,
  voucherState,
  type Voucher,
  type VoucherRef,
  type VoucherState,
} from './voucher';

interface InvoiceDetailProps {
  invoiceId: string;
}

const STATE_TONE: Record<VoucherState, BadgeVariant> = {
  authorized: 'success',
  credited: 'neutral',
  pending: 'warning',
};

const MONO = 'font-mono tabular-nums';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

function positive(value?: string | number | null): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** El comprobante como sale impreso: emisor, letra, receptor, importes y el CAE al pie. */
export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const t = useTranslations('invoices.detail');
  const tTypeNames = useTranslations('invoices.typesLong');
  const tTypes = (type: string) => (tTypeNames.has(type) ? tTypeNames(type) : type);
  const tInvoices = useTranslations('invoices');
  const tState = useTranslations('invoices.arcaStates');
  const tEnv = useTranslations('invoices.environment');
  const tFc = useTranslations('persons.fiscalConditions');
  const tMethods = useTranslations('liquidaciones.paymentMethods');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('invoices.errors');
  const locale = useLocale();

  const [data, setData] = useState<Voucher | null>(null);
  const [issuer, setIssuer] = useState<ArcaIssuerDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const canEmit = useCan('invoices.emit');
  const environment = useArcaEnvironment();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<Voucher>(`/invoices/${invoiceId}`);
      setData(res);
      // El emisor es un dato de contexto: si no se puede leer, el comprobante se muestra igual.
      try {
        const issuers = await apiClient<ArcaIssuerDTO[]>('/invoices/issuers');
        setIssuer(Array.isArray(issuers) ? (issuers.find((i) => i.id === res.issuerId) ?? null) : null);
      } catch {
        setIssuer(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function handleDownloadPdf() {
    if (!data) return;
    setPdfDownloading(true);
    try {
      await downloadFile(`/invoices/${invoiceId}/pdf`, `comprobante-${data.type}-${voucherNumber(data)}.pdf`);
    } catch {
      toast.error(tCommon('downloadFailed'));
    } finally {
      setPdfDownloading(false);
    }
  }

  const back = (
    <Link
      href="/invoices"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      <Icon name="arrowLeft" className="h-4 w-4" />
      {t('back')}
    </Link>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{tErrors('notFound')}</h2>
        {back}
      </div>
    );
  }

  const isNC = isCreditNote(data.type);
  const state = voucherState(data);
  const currency = data.currency ?? 'ARS';
  const money = (value: string | number | null | undefined) => formatMoneyFixed(value, currency, locale);
  const fiscal = (value?: string | null) => (value ? (tFc.has(value) ? tFc(value) : value) : null);
  const refLabel = (ref: VoucherRef) => `${tTypes(ref.type)} ${voucherNumber(ref)}`;
  const code = voucherCode(data.cbteTipo);
  const neto = positive(data.impNeto);
  const iva = positive(data.impIva);
  const exento = positive(data.impExento);
  const tributos = positive(data.impTrib);
  const showBreakdown = iva !== null || exento !== null || tributos !== null;
  const creditNotes = data.creditNotes ?? [];
  const method = data.payment?.method;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          {isInvoice(data.type) && canEmit && (
            <Link
              href={`/invoices/${invoiceId}/nc`}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              {tInvoices('emitNC')}
            </Link>
          )}
          <Button type="button" size="sm" onClick={() => void handleDownloadPdf()} disabled={pdfDownloading}>
            <Icon name="download" className="h-4 w-4" />
            {pdfDownloading ? tInvoices('downloading') : tInvoices('downloadPdf')}
          </Button>
        </div>
      </div>

      <article
        aria-label={`${tTypes(data.type)} ${voucherNumber(data)}`}
        className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
      >
        {environment === 'testing' && (
          <p
            role="note"
            className="border-b border-dashed border-[color-mix(in_oklab,var(--color-warning)_55%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warning)_12%,var(--color-surface))] px-5 py-2 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[color-mix(in_oklab,var(--color-warning)_70%,var(--color-text))]"
          >
            {tEnv('testingStamp')}
          </p>
        )}

        {/* Encabezado: emisor, letra y datos del comprobante */}
        <header className="grid grid-cols-1 gap-5 border-b border-[var(--color-border)] p-5 sm:grid-cols-[1fr_auto_1fr] sm:gap-6 sm:p-6">
          <div className="order-2 min-w-0 sm:order-1">
            <p className={LABEL}>{t('issuer')}</p>
            {issuer ? (
              <>
                <p className="mt-1 font-semibold text-[var(--color-text)]">{issuer.businessName}</p>
                <p className={`${MONO} text-sm text-[var(--color-text)]`}>CUIT {formatDocNumber(issuer.cuit)}</p>
                <p className="text-sm text-[var(--color-muted)]">{fiscal(issuer.fiscalCondition)}</p>
                {issuer.businessAddress && <p className="text-sm text-[var(--color-muted)]">{issuer.businessAddress}</p>}
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-muted)]">{t('issuerUnknown')}</p>
            )}
          </div>

          <div className="order-1 flex items-start gap-4 sm:order-2 sm:flex-col sm:items-center sm:gap-1">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-[var(--color-text)] font-mono text-3xl font-bold text-[var(--color-text)]"
              aria-hidden="true"
            >
              {voucherLetter(data.type)}
            </div>
            {code && <p className={`${MONO} hidden text-[10px] text-[var(--color-muted)] sm:block`}>{t('code', { code })}</p>}
            <div className="sm:hidden">
              <p className="text-lg font-semibold uppercase tracking-wide text-[var(--color-text)]">{tTypes(data.type)}</p>
              <p className={`${MONO} text-base text-[var(--color-text)]`}>{voucherNumber(data)}</p>
            </div>
          </div>

          <div className="order-3 sm:text-right">
            <p className="hidden text-lg font-semibold uppercase tracking-wide text-[var(--color-text)] sm:block">
              {tTypes(data.type)}
            </p>
            <p className={`${MONO} hidden text-base text-[var(--color-text)] sm:block`}>
              {t('numberShort')} {voucherNumber(data)}
            </p>
            <p className="text-sm text-[var(--color-muted)] sm:mt-1">
              {t('createdAt')}{' '}
              <span className="tabular-nums text-[var(--color-text)]">
                {formatLocalDate(data.emittedAt ?? data.createdAt, 'numeric', locale)}
              </span>
            </p>
          </div>
        </header>

        {/* Receptor */}
        <section aria-label={t('receptor')} className="border-b border-[var(--color-border)] p-5 sm:p-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('receptor')}>
              <span className="font-medium">{data.receptorName || t('noData')}</span>
            </Field>
            <Field label={t('receptorCuit')}>
              <span className={MONO}>{formatDocNumber(data.docNro) ?? t('noData')}</span>
            </Field>
            {data.receptorFiscalCondition && (
              <Field label={t('receptorFiscalCondition')}>{fiscal(data.receptorFiscalCondition)}</Field>
            )}
            {data.fchServDesde && data.fchServHasta && (
              <Field label={t('servicePeriod')}>
                <span className="tabular-nums">
                  {formatDate(data.fchServDesde, 'numeric', locale)} – {formatDate(data.fchServHasta, 'numeric', locale)}
                </span>
              </Field>
            )}
            {data.fchVtoPago && (
              <Field label={t('paymentDue')}>
                <span className="tabular-nums">{formatDate(data.fchVtoPago, 'numeric', locale)}</span>
              </Field>
            )}
          </dl>
        </section>

        {/* Importes */}
        <section aria-label={t('amounts')} className="border-b border-[var(--color-border)] p-5 sm:p-6">
          <dl className="ml-auto max-w-sm space-y-1.5 text-sm">
            {showBreakdown && neto !== null && (
              <div className="flex justify-between gap-6">
                <dt className="text-[var(--color-muted)]">{t('netAmount')}</dt>
                <dd className={MONO}>{money(neto)}</dd>
              </div>
            )}
            {iva !== null && (
              <div className="flex justify-between gap-6">
                <dt className="text-[var(--color-muted)]">{t('ivaAmount')}</dt>
                <dd className={MONO}>{money(iva)}</dd>
              </div>
            )}
            {exento !== null && (
              <div className="flex justify-between gap-6">
                <dt className="text-[var(--color-muted)]">{t('exemptAmount')}</dt>
                <dd className={MONO}>{money(exento)}</dd>
              </div>
            )}
            {tributos !== null && (
              <div className="flex justify-between gap-6">
                <dt className="text-[var(--color-muted)]">{t('taxesAmount')}</dt>
                <dd className={MONO}>{money(tributos)}</dd>
              </div>
            )}
            <div
              className={`flex items-baseline justify-between gap-6 ${
                showBreakdown ? 'border-t border-[var(--color-border)] pt-2' : ''
              }`}
            >
              <dt className="font-semibold uppercase tracking-wide text-[var(--color-text)]">{t('amount')}</dt>
              <dd className={`${MONO} text-2xl font-semibold ${isNC ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'}`}>
                {isNC ? '- ' : ''}
                {money(data.impTotal)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Pie: autorización de ARCA */}
        <footer className="flex flex-wrap items-end justify-between gap-4 bg-[var(--color-surface-sunken)] p-5 sm:p-6">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Field label={t('cae')}>
              <span className={`${MONO} text-base font-semibold`}>{data.cae || t('caePending')}</span>
            </Field>
            {data.caeFchVto && (
              <Field label={t('caeExpiration')}>
                <span className="tabular-nums">{formatDate(data.caeFchVto, 'numeric', locale)}</span>
              </Field>
            )}
          </dl>
          <Badge variant={STATE_TONE[state]} size="md" dot>
            {tState(state)}
          </Badge>
        </footer>
      </article>

      {/* Vínculos: de dónde sale y qué otros comprobantes lo tocan */}
      {(data.originalComprobante || creditNotes.length > 0 || method) && (
        <dl className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm">
          {isNC && data.originalComprobante && (
            <Field label={t('originalComprobante')}>
              <Link href={`/invoices/${data.originalComprobante.id}`} className={`${MONO} font-medium text-brand-600 hover:text-brand-700`}>
                {refLabel(data.originalComprobante)}
              </Link>
            </Field>
          )}
          {creditNotes.length > 0 && (
            <Field label={t('creditNotes')}>
              <ul className="space-y-0.5">
                {creditNotes.map((nc) => (
                  <li key={nc.id} className="flex flex-wrap items-baseline gap-x-3">
                    <Link href={`/invoices/${nc.id}`} className={`${MONO} font-medium text-brand-600 hover:text-brand-700`}>
                      {refLabel(nc)}
                    </Link>
                    {nc.impTotal != null && <span className={`${MONO} text-[var(--color-danger)]`}>- {money(nc.impTotal)}</span>}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {method && (
            <Field label={t('payment')}>
              {[
                tMethods.has(method) ? tMethods(method) : method,
                data.payment?.reference,
                data.payment?.paidAt ? formatLocalDate(data.payment.paidAt, 'numeric', locale) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Field>
          )}
        </dl>
      )}
    </div>
  );
}
