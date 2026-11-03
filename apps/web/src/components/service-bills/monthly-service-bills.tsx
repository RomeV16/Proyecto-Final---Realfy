'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/permissions';
import { formatMoneyFixed } from '@/lib/format';
import {
  currentMonth,
  defaultInstallment,
  parseAmountInput,
  checkUnitConsumptions,
  initialUnitValues,
  parseConsumptionInput,
  parseDateInput,
  proposedDueDate,
  type BulkResponse,
  type ServiceBill,
  type SheetResponse,
  type SheetRow,
  type UnitValues,
} from '@/lib/service-bills';
import { cellKey, useEditableGrid, type GridColumn, type GridValues } from '@/hooks/use-editable-grid';
import { Button } from '@/components/ui/button';
import { EditableDataTable } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { inputStyles } from '@/components/ui/input';
import { UnitConsumptionsPanel } from './unit-consumptions-panel';

type Translate = ReturnType<typeof useTranslations>;

/** Quién paga, según las reglas vigentes de los contratos del servicio, en una línea. */
function payerSummary(row: SheetRow, t: Translate, currency: string): string {
  if (row.rules.length === 0) return t('payer.none');
  return row.rules
    .map((rule) => {
      const mode =
        rule.splitMode === 'Porcentaje'
          ? t('payer.modes.Porcentaje', { pct: Number(rule.tenantSharePct) })
          : rule.splitMode === 'Fijo'
            ? t('payer.modes.Fijo', { amount: formatMoneyFixed(rule.fixedAmount, currency) })
            : t('payer.modes.Consumo');
      const plan = rule.paymentPlan === 'Anual' ? `, ${t('payer.annual')}` : '';
      return rule.payer === 'Inquilino'
        ? t('payer.Inquilino')
        : `${t(`payer.${rule.payer}`)} (${mode}${plan})`;
    })
    .join(' · ');
}

/** Una fila por servicio y boleta del período; el servicio sin boleta es una fila para cargar. */
function buildRows(sheet: SheetResponse, t: Translate, tTypes: Translate) {
  const period = sheet.period.slice(0, 7);
  return sheet.rows.flatMap((row) => {
    const { service } = row;
    const base = {
      serviceId: service.id,
      property: service.property?.title ?? '',
      service: [tTypes(service.serviceType), service.providerName].filter(Boolean).join(' · '),
      payer: payerSummary(row, t, service.currency),
    };
    if (row.bills.length === 0) {
      const values: GridValues = {
        ...base,
        billId: '',
        loadedLabel: '',
        status: t('status.none'),
        installment: defaultInstallment(period),
        amount: '',
        dueDate: proposedDueDate(period, service.dueDay),
        consumption: '',
      };
      return [{ id: `svc:${service.id}`, values }];
    }
    return row.bills.map((bill) => {
      const values: GridValues = {
        ...base,
        billId: bill.id,
        loadedLabel: bill.installmentLabel,
        status: t(`status.${bill.status}`),
        installment: bill.installmentLabel,
        amount: String(Number(bill.amount)),
        dueDate: bill.dueDate ? bill.dueDate.slice(0, 10) : '',
        consumption: bill.consumption != null ? String(Number(bill.consumption)) : '',
      };
      return { id: `bill:${bill.id}`, values };
    });
  });
}

interface RowFailure {
  rowId: string;
  title: string;
  code: string;
  message: string;
}

/** La grilla de un mes ya cargado; se vuelve a montar (key) al cambiar de mes o después de guardar. */
function BillsGrid({
  sheet,
  canManage,
  onSaved,
}: {
  sheet: SheetResponse;
  canManage: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('serviceBills');
  const tTypes = useTranslations('services.serviceTypes');
  const tErrors = useTranslations('errors');
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<RowFailure[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const initialRows = useMemo(() => buildRows(sheet, t, tTypes), [sheet, t, tTypes]);
  const sheetRows = useMemo(() => new Map(sheet.rows.map((r) => [r.service.id, r])), [sheet]);
  /** La boleta ya cargada de cada fila: de ella se reenvía lo que la planilla no edita. */
  const loadedBills = useMemo(
    () => new Map<string, ServiceBill>(sheet.rows.flatMap((r) => r.bills.map((b) => [`bill:${b.id}`, b] as const))),
    [sheet],
  );
  /** Consumo por unidad de cada fila, texto editable; arranca con lo que la boleta ya trae. */
  const [unitValues, setUnitValues] = useState<Record<string, UnitValues>>(() =>
    Object.fromEntries(initialRows.map((r) => [r.id, initialUnitValues(loadedBills.get(r.id))])),
  );
  const [unitDirty, setUnitDirty] = useState<Set<string>>(new Set());

  const columns = useMemo<GridColumn[]>(
    () => [
      { key: 'property', header: t('columns.property'), readOnly: true, className: 'min-w-36' },
      { key: 'service', header: t('columns.service'), readOnly: true, className: 'min-w-36' },
      { key: 'payer', header: t('columns.payer'), readOnly: true, className: 'min-w-44 text-xs' },
      {
        key: 'installment',
        header: t('columns.installment'),
        className: 'w-28',
        validate: (value, row) =>
          row.loadedLabel && value !== row.loadedLabel ? 'serviceBills.validation.installmentLocked' : null,
      },
      {
        key: 'amount',
        header: t('columns.amount'),
        type: 'decimal',
        className: 'w-32',
        validate: (value) => (parseAmountInput(value) === null ? 'serviceBills.validation.amount' : null),
      },
      {
        key: 'dueDate',
        header: t('columns.dueDate'),
        className: 'w-36',
        placeholder: t('datePlaceholder'),
        validate: (value) => (parseDateInput(value) === null ? 'serviceBills.validation.date' : null),
      },
      {
        key: 'consumption',
        header: t('columns.consumption'),
        type: 'decimal',
        className: 'w-28',
        validate: (value) =>
          parseConsumptionInput(value) === null ? 'serviceBills.validation.consumption' : null,
      },
      { key: 'status', header: t('columns.status'), readOnly: true, className: 'w-28 text-xs' },
    ],
    [t],
  );

  const grid = useEditableGrid({ columns, initialRows, allowAddRows: false });

  /** Filas a guardar: con importe y algún campo editado. Las demás (sin importe, sin tocar) se ignoran. */
  const savable = grid.filledRows.filter(
    (row) =>
      (row.values.amount ?? '').trim() !== '' &&
      (unitDirty.has(row.id) || columns.some((c) => !c.readOnly && grid.dirtyCells.has(cellKey(row.id, c.key)))),
  );

  const checkOf = (rowId: string, values: GridValues) => {
    const sheetRow = sheetRows.get(values.serviceId);
    return sheetRow ? checkUnitConsumptions(sheetRow, unitValues[rowId] ?? {}, values.consumption ?? '') : null;
  };
  /** Filas con consumo por unidad (panel), con su estado. */
  const unitPanels = grid.rows.flatMap((row) => {
    const sheetRow = sheetRows.get(row.values.serviceId);
    if (!sheetRow || (sheetRow.units ?? []).length === 0) return [];
    return [{ row, sheetRow, check: checkOf(row.id, row.values)! }];
  });

  function setUnit(rowId: string, propertyId: string, value: string) {
    setUnitValues((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [propertyId]: value } }));
    setUnitDirty((prev) => new Set(prev).add(rowId));
  }

  async function save() {
    setSubmitted(true);
    const unitErrors = savable.some((row) => Object.keys(checkOf(row.id, row.values)?.errors ?? {}).length > 0);
    if (!grid.validateAll() || savable.length === 0 || unitErrors) return;
    setSubmitted(false);
    setSaving(true);
    setFailures([]);
    try {
      const payload = savable.map((row) => {
        const v = row.values;
        const dueDate = (v.dueDate ?? '').trim();
        const consumption = (v.consumption ?? '').trim();
        const loaded = loadedBills.get(row.id);
        const units = checkOf(row.id, v)?.entries ?? [];
        return {
          serviceId: v.serviceId,
          period: sheet.period.slice(0, 7),
          installmentLabel: v.loadedLabel || (v.installment ?? '').trim() || undefined,
          amount: parseAmountInput(v.amount),
          dueDate: dueDate ? parseDateInput(dueDate) : null,
          consumption: consumption ? parseConsumptionInput(consumption) : null,
          unitConsumptions: units.length > 0 ? units : null,
          ...(loaded && { nominalAmount: loaded.nominalAmount ?? null, notes: loaded.notes ?? null }),
        };
      });
      const res = await apiClient<BulkResponse>('/service-bills/bulk', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const failed = res.results.filter((r) => r.status === 'error');
      if (failed.length === 0) {
        toast.success(t('save.done', { count: res.created + res.updated, unchanged: res.unchanged }));
        onSaved();
        return;
      }
      setFailures(
        failed.map((r) => {
          const row = savable[r.index];
          const code = r.error?.code ?? 'ERROR';
          return {
            rowId: row.id,
            title: `${row.values.property} · ${row.values.service}`,
            code,
            message: tErrors.has(`codes.${code}`) ? tErrors(`codes.${code}`) : (r.error?.message ?? code),
          };
        }),
      );
      toast.error(t('save.partial', { failed: failed.length, saved: res.created + res.updated + res.unchanged }));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('save.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <EditableDataTable
        grid={grid}
        columns={columns}
        label={t('gridLabel')}
        footer={
          canManage ? (
            <Button type="button" size="sm" onClick={save} disabled={saving || savable.length === 0}>
              {saving ? t('save.saving') : t('save.action', { count: savable.length })}
            </Button>
          ) : undefined
        }
      />
      {unitPanels.map(({ row, sheetRow, check }) => (
        <UnitConsumptionsPanel
          key={row.id}
          row={sheetRow}
          period={sheet.period.slice(0, 7)}
          title={`${row.values.property} · ${row.values.service}`}
          values={unitValues[row.id] ?? {}}
          check={check}
          amount={row.values.amount ?? ''}
          consumption={row.values.consumption ?? ''}
          showMissing={submitted || check.entries.length > 0}
          onChange={(propertyId, value) => setUnit(row.id, propertyId, value)}
        />
      ))}
      {failures.length > 0 && (
        <div role="alert" className="rounded-lg border border-[var(--color-danger)] p-4 text-sm">
          <p className="mb-2 font-medium text-[var(--color-danger)]">{t('save.failuresTitle')}</p>
          <ul className="space-y-1">
            {failures.map((f) => (
              <li key={f.rowId}>
                <span className="font-medium">{f.title}</span>: {f.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-muted)]">{t('save.retryHint')}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Boletas del mes: una fila por servicio (y boleta) del período elegido, con quién paga según las reglas de los
 * contratos. Se cargan importe, cuota, vencimiento y consumo a mano o pegando desde una planilla, y se guardan
 * juntas; cargar dos veces lo mismo no duplica nada.
 */
export function MonthlyServiceBills() {
  const t = useTranslations('serviceBills');
  const canManage = useCan('serviceBills.manage');

  const [period, setPeriod] = useState(currentMonth);
  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setSheet(null);
    setError(null);
    try {
      setSheet(await apiClient<SheetResponse>(`/service-bills/sheet?period=${period}`));
    } catch (err) {
      setError(err);
    }
  }, [period]);

  useEffect(() => {
    if (canManage && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) void load();
  }, [canManage, period, version, load]);

  if (!canManage) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="service-bills-period" className="text-xs font-medium text-[var(--color-muted)]">
            {t('period')}
          </label>
          <input
            id="service-bills-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={inputStyles({ className: 'w-44' })}
          />
        </div>
      </header>

      {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
      {error == null && sheet === null && <Skeleton className="h-48 w-full" />}
      {sheet !== null && sheet.rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted)]">
          {t('empty')}
        </p>
      )}
      {sheet !== null && sheet.rows.length > 0 && (
        <BillsGrid
          key={`${sheet.period}:${version}`}
          sheet={sheet}
          canManage={canManage}
          onSaved={() => setVersion((v) => v + 1)}
        />
      )}
      <p className="text-xs text-[var(--color-muted)]">{t('lateNote')}</p>
    </div>
  );
}
