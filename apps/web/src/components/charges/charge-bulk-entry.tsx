'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChargeTarget, PendingChargeKind } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { CHARGE_KINDS, CHARGE_TARGETS, chargeBody, parseChargeAmount, type BulkChargesResponse } from '@/lib/charges';
import { parseDateInput } from '@/lib/service-bills';
import { toast } from '@/lib/toast';
import { useEditableGrid, type GridColumn } from '@/hooks/use-editable-grid';
import { Button } from '@/components/ui/button';
import { EditableDataTable } from '@/components/ui/data-table';
import type { ChargeContractOption } from './use-charge-targets';

interface RowFailure {
  rowId: string;
  title: string;
  message: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Carga de varios gastos a la vez, escritos o pegados desde una planilla. Cada fila es un cargo a un contrato;
 * las que fallan se informan por fila y las demás se guardan.
 */
export function ChargeBulkEntry({ contracts, onSaved }: { contracts: ChargeContractOption[]; onSaved: () => void }) {
  const t = useTranslations('charges');
  const tErrors = useTranslations('errors');
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<RowFailure[]>([]);

  const columns = useMemo<GridColumn[]>(
    () => [
      {
        key: 'contractId',
        header: t('bulk.columns.contract'),
        type: 'select',
        required: true,
        className: 'min-w-44',
        options: contracts.map((c) => ({ value: c.id, label: c.label })),
      },
      {
        key: 'chargedTo',
        header: t('bulk.columns.chargedTo'),
        type: 'select',
        className: 'w-36',
        options: CHARGE_TARGETS.map((v) => ({ value: v, label: t(`targets.${v}`) })),
      },
      {
        key: 'kind',
        header: t('bulk.columns.kind'),
        type: 'select',
        className: 'w-44',
        options: CHARGE_KINDS.map((v) => ({ value: v, label: t(`kinds.${v}`) })),
      },
      { key: 'description', header: t('bulk.columns.description'), required: true, className: 'min-w-48' },
      {
        key: 'amount',
        header: t('bulk.columns.amount'),
        type: 'decimal',
        required: true,
        className: 'w-32',
        validate: (value) => (parseChargeAmount(value) === null ? 'charges.bulk.validation.amount' : null),
      },
      {
        key: 'incurredAt',
        header: t('bulk.columns.incurredAt'),
        className: 'w-36',
        placeholder: t('bulk.datePlaceholder'),
        validate: (value) => (parseDateInput(value) === null ? 'charges.bulk.validation.date' : null),
      },
      {
        key: 'installments',
        header: t('bulk.columns.installments'),
        className: 'w-24',
        validate: (value) => (/^([1-9]|[1-2]\d|3[0-6])$/.test(value.trim()) ? null : 'charges.bulk.validation.installments'),
      },
    ],
    [contracts, t],
  );

  const grid = useEditableGrid({ columns, initialRows: [] });

  const savable = grid.filledRows;

  async function save() {
    if (!grid.validateAll() || savable.length === 0) return;
    setSaving(true);
    setFailures([]);
    try {
      // Lo que se deja en blanco toma el valor habitual: reparación al inquilino, con fecha de hoy.
      const rows = savable.map((row) =>
        chargeBody({
          ...row.values,
          propertyId: '',
          chargedTo: row.values.chargedTo || ChargeTarget.Inquilino,
          kind: row.values.kind || PendingChargeKind.Reparacion,
          incurredAt: row.values.incurredAt || today(),
        }),
      );
      const res = await apiClient<BulkChargesResponse>('/charges/bulk', { method: 'POST', body: JSON.stringify({ rows }) });
      const failed = res.results.filter((r) => r.status === 'error');
      if (failed.length === 0) {
        toast.success(t('bulk.save.done', { count: res.created }));
        onSaved();
        return;
      }
      // Las filas guardadas salen de la planilla: volver a guardar las que fallaron no repite las demás.
      for (const r of res.results) if (r.status === 'created') grid.removeRow(savable[r.index].id);
      setFailures(
        failed.map((r) => {
          const row = savable[r.index];
          const code = r.error?.code ?? 'ERROR';
          return {
            rowId: row.id,
            title: row.values.description,
            message: tErrors.has(`codes.${code}`) ? tErrors(`codes.${code}`) : (r.error?.message ?? code),
          };
        }),
      );
      toast.error(t('bulk.save.partial', { failed: failed.length, saved: res.created }));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('bulk.save.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('bulk.title')}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('bulk.hint')}</p>
      </div>
      <EditableDataTable
        grid={grid}
        columns={columns}
        label={t('bulk.gridLabel')}
        footer={
          <Button type="button" size="sm" onClick={save} disabled={saving || savable.length === 0}>
            {saving ? t('bulk.save.saving') : t('bulk.save.action', { count: savable.length })}
          </Button>
        }
      />
      {failures.length > 0 && (
        <div role="alert" className="rounded-lg border border-[var(--color-danger)] p-4 text-sm">
          <p className="mb-2 font-medium text-[var(--color-danger)]">{t('bulk.save.failuresTitle')}</p>
          <ul className="space-y-1">
            {failures.map((f) => (
              <li key={f.rowId}>
                <span className="font-medium">{f.title}</span>: {f.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-muted)]">{t('bulk.save.retryHint')}</p>
        </div>
      )}
    </section>
  );
}
