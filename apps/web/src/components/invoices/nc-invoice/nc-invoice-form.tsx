'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useEffect, useState, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import type { EmitResult } from '@/lib/schemas/invoices';
import { formatMoneyFixed, formatLocalDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { inputStyles } from '@/components/ui/input';
import { TestingNotice, useArcaEnvironment } from '../arca-environment';
import { formatDocNumber, isCreditNote, voucherNumber } from '../voucher';
import { buildCreditNotePayload, creditableAmount, type OriginalVoucher } from './credit-note-payload';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

interface NcInvoiceFormProps {
  originalInvoiceId: string;
}

export function NcInvoiceForm({ originalInvoiceId }: NcInvoiceFormProps) {
  const t = useTranslations('invoices.nc');
  const tTypes = useTranslations('invoices.typesLong');
  const environment = useArcaEnvironment();
  const router = useRouter();

  const [original, setOriginal] = useState<OriginalVoucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [amount, setAmount] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fchServDesde, setFchServDesde] = useState('');
  const [fchServHasta, setFchServHasta] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [clientRequestId] = useState(() => generateId());

  const fetchOriginal = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<OriginalVoucher>(`/invoices/${originalInvoiceId}`);
      setOriginal(res);
      setAmount(creditableAmount(res).toFixed(2));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [originalInvoiceId]);

  useEffect(() => {
    void fetchOriginal();
  }, [fetchOriginal]);

  const maxAmount = original ? creditableAmount(original) : 0;
  const alreadyCredited = original ? Math.max(0, Number(original.impTotal) - maxAmount) : 0;
  const parsedAmount = Number(amount);
  const amountOk = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= maxAmount + 0.001;
  const isValid = descripcion.trim() !== '' && amountOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!original || !isValid) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient<EmitResult>('/invoices/emit-nc', {
        method: 'POST',
        body: JSON.stringify(
          buildCreditNotePayload(original, {
            amount: parsedAmount,
            description: descripcion.trim(),
            serviceFrom: fchServDesde,
            serviceTo: fchServHasta,
            clientRequestId,
          }),
        ),
      });
      router.push(`/invoices/${res.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError && err.message ? err.message : t('emitError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  // Una nota de crédito no se acredita con otra: solo se llega acá escribiendo la dirección a mano.
  if (notFound || !original || isCreditNote(original.type)) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{t('notFound')}</h2>
        <Link href="/invoices" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t('backToList')}
        </Link>
      </div>
    );
  }

  const label = 'mb-1 block text-xs font-medium text-[var(--color-muted)]';

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <Link
          href={`/invoices/${original.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          <Icon name="arrowLeft" className="h-4 w-4" />
          {t('backToVoucher')}
        </Link>
        <h1 className="h1 mt-2">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>

      <TestingNotice environment={environment} />

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        {/* El comprobante que se acredita */}
        <div className="space-y-1 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
            {t('originalLabel')}
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <p className="font-mono text-sm font-medium tabular-nums text-[var(--color-text)]">
              {tTypes.has(original.type) ? tTypes(original.type) : original.type} {voucherNumber(original)}
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
              {formatMoneyFixed(original.impTotal)}
            </p>
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            {[
              original.receptorName,
              formatDocNumber(original.docNro),
              formatLocalDate(original.emittedAt ?? original.createdAt, 'numeric'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="ncDescripcion" className={label}>
              {t('descripcion')} *
            </label>
            <input
              id="ncDescripcion"
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={t('descripcionPlaceholder')}
              maxLength={500}
              required
              className={inputStyles({})}
            />
          </div>

          <div>
            <label htmlFor="ncAmount" className={label}>
              {t('amount')} *
            </label>
            <input
              id="ncAmount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max={maxAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              aria-invalid={amount !== '' && !amountOk}
              aria-describedby="ncAmountHint"
              className={inputStyles({ invalid: amount !== '' && !amountOk, className: 'font-mono tabular-nums' })}
            />
            <p id="ncAmountHint" className="mt-1 text-xs text-[var(--color-muted)]">
              {maxAmount > 0 ? t('amountHint', { max: formatMoneyFixed(maxAmount) }) : t('fullyCredited')}
              {alreadyCredited > 0 && maxAmount > 0 && <> {t('creditedHint', { credited: formatMoneyFixed(alreadyCredited) })}</>}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ncFchDesde" className={label}>
                {t('fchServDesde')}
              </label>
              <input
                id="ncFchDesde"
                type="date"
                value={fchServDesde}
                onChange={(e) => setFchServDesde(e.target.value)}
                className={inputStyles({})}
              />
            </div>
            <div>
              <label htmlFor="ncFchHasta" className={label}>
                {t('fchServHasta')}
              </label>
              <input
                id="ncFchHasta"
                type="date"
                value={fchServHasta}
                onChange={(e) => setFchServHasta(e.target.value)}
                className={inputStyles({})}
              />
            </div>
          </div>

          {error && (
            <div
              className="rounded-lg border border-[color-mix(in_oklab,var(--color-danger)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))] p-3 text-sm text-[var(--color-danger)]"
              role="alert"
            >
              {error}
            </div>
          )}

          <p className="text-xs text-[var(--color-muted)]">{t('irreversible')}</p>

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => router.push(`/invoices/${original.id}`)}>
              {t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !isValid}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
