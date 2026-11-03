'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { formatMoneyFixed } from '@/lib/format';
import {
  parseAmountInput,
  parseConsumptionInput,
  type PreviewResponse,
  type SheetRow,
  type UnitCheck,
  type UnitValues,
} from '@/lib/service-bills';
import { Button } from '@/components/ui/button';
import { inputStyles } from '@/components/ui/input';

interface Props {
  row: SheetRow;
  /** Mes de la boleta, `YYYY-MM`. */
  period: string;
  /** Título de la fila de la planilla (propiedad · servicio). */
  title: string;
  values: UnitValues;
  check: UnitCheck;
  /** Importe y consumo total escritos en la planilla. */
  amount: string;
  consumption: string;
  /** Muestra también los consumos que faltan (al intentar guardar o cuando ya se empezó a cargar). */
  showMissing: boolean;
  onChange: (propertyId: string, value: string) => void;
}

/**
 * Consumo de cada unidad de una boleta que se reparte entre varias (un edificio con una sola boleta de agua,
 * por ejemplo): una fila por unidad, la suma y la vista previa del reparto con las reglas vigentes.
 */
export function UnitConsumptionsPanel({ row, period, title, values, check, amount, consumption, showMissing, onChange }: Props) {
  const t = useTranslations('serviceBills.units');
  const tSkipped = useTranslations('serviceBills.units.skipped');
  const headingId = useId();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'noAmount'>('idle');
  const [errorText, setErrorText] = useState('');

  const units = row.units ?? [];
  const known = new Set(units.map((u) => u.propertyId));
  /** Unidades que la boleta ya trae y que ya no están en el edificio: se muestran para no perderlas. */
  const extras = Object.keys(values).filter((id) => !known.has(id));
  const currency = row.service.currency;
  const contractLabel = (contractId: string) =>
    row.rules.find((r) => r.contractId === contractId)?.propertyTitle || contractId;

  async function loadPreview() {
    const parsedAmount = parseAmountInput(amount);
    if (parsedAmount === null) {
      setState('noAmount');
      return;
    }
    setState('loading');
    try {
      const parsedTotal = consumption.trim() === '' ? null : parseConsumptionInput(consumption);
      setPreview(
        await apiClient<PreviewResponse>('/service-bills/preview', {
          method: 'POST',
          body: JSON.stringify({
            serviceId: row.service.id,
            period,
            amount: parsedAmount,
            consumption: parsedTotal,
            unitConsumptions: check.entries,
          }),
        }),
      );
      setState('idle');
    } catch (err) {
      setErrorText(err instanceof ApiRequestError ? err.message : '');
      setState('error');
    }
  }

  const blocked = Object.keys(check.errors).some((id) => check.errors[id] === 'invalid');

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <div>
        <h3 id={headingId} className="text-sm font-semibold text-[var(--color-text)]">
          {t('title', { name: title })}
        </h3>
        <p className="mt-1 text-xs text-[var(--color-muted)]">{t('hint')}</p>
      </div>

      <table className="w-full max-w-xl text-sm">
        <caption className="sr-only">{t('caption', { name: title })}</caption>
        <thead>
          <tr className="text-left text-xs text-[var(--color-muted)]">
            <th scope="col" className="pb-1 font-medium">
              {t('unit')}
            </th>
            <th scope="col" className="w-40 pb-1 font-medium">
              {t('consumption')}
            </th>
          </tr>
        </thead>
        <tbody>
          {[...units.map((u) => ({ id: u.propertyId, title: u.title })), ...extras.map((id) => ({ id, title: t('other') }))].map(
            (unit) => {
              const error = check.errors[unit.id];
              const visible = error === 'invalid' || (error === 'missing' && showMissing);
              const errorId = `${headingId}-${unit.id}-error`;
              return (
                <tr key={unit.id}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {unit.title}
                  </th>
                  <td className="py-1">
                    <input
                      inputMode="decimal"
                      aria-label={t('inputLabel', { unit: unit.title })}
                      aria-invalid={visible}
                      aria-describedby={visible ? errorId : undefined}
                      value={values[unit.id] ?? ''}
                      onChange={(e) => onChange(unit.id, e.target.value)}
                      className={inputStyles({ invalid: visible, className: 'h-9' })}
                    />
                    {visible && (
                      <p id={errorId} className="mt-0.5 text-xs text-[var(--color-danger)]">
                        {t(error === 'invalid' ? 'errors.invalid' : 'errors.missing')}
                      </p>
                    )}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--color-border)] font-medium">
            <th scope="row" className="pt-2 pr-3 text-left font-medium">
              {t('sum')}
            </th>
            <td className="pt-2 tabular-nums">{check.sum}</td>
          </tr>
        </tfoot>
      </table>

      {check.totalBelowSum && (
        <p role="status" className="text-xs text-[var(--color-warning,var(--color-danger))]">
          {t('totalBelowSum', { sum: check.sum })}
        </p>
      )}
      {check.untransferred !== null && (
        <p className="text-xs text-[var(--color-muted)]">{t('untransferred', { amount: check.untransferred })}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="secondary" onClick={() => void loadPreview()} disabled={blocked || state === 'loading'}>
          {state === 'loading' ? t('preview.loading') : t('preview.action')}
        </Button>
        {state === 'noAmount' && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {t('preview.noAmount')}
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {errorText || t('preview.error')}
          </p>
        )}
      </div>

      <div aria-live="polite">
        {preview !== null && state === 'idle' && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{t('preview.title')}</p>
            {preview.allocations.length === 0 && <p className="text-xs text-[var(--color-muted)]">{t('preview.none')}</p>}
            {preview.allocations.length > 0 && (
              <table className="w-full max-w-xl" aria-label={t('preview.title')}>
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th scope="col" className="font-medium">{t('unit')}</th>
                    <th scope="col" className="font-medium">{t('preview.basis')}</th>
                    <th scope="col" className="text-right font-medium">{t('preview.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.allocations.map((a) => (
                    <tr key={`${a.contractId}:${a.chargePeriod}:${a.installmentNo}`}>
                      <th scope="row" className="py-0.5 text-left font-normal">{contractLabel(a.contractId)}</th>
                      <td className="py-0.5 text-xs text-[var(--color-muted)]">{a.basis}</td>
                      <td className="py-0.5 text-right tabular-nums">{formatMoneyFixed(a.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.skipped.length > 0 && (
              <ul className="space-y-0.5 text-xs text-[var(--color-muted)]">
                {preview.skipped.map((s) => (
                  <li key={`${s.contractId}:${s.reason}`}>
                    {contractLabel(s.contractId)}: {tSkipped.has(s.reason) ? tSkipped(s.reason) : s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
