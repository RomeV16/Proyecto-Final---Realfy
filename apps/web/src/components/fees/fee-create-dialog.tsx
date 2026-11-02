'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ContractPeriodKind, FeeKind, SaleAsset } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { checkDraft, draftFromPreview, FEE_KINDS, isRentalKind, type FeeDraft, type FeePreview } from '@/lib/fees';
import { formatMoney } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useChargeTargets } from '@/components/charges/use-charge-targets';
import { FeeDraftEditor } from './fee-draft-editor';
import { useStaffUsers } from './use-staff-users';

interface ContractPeriodRow {
  id: string;
  seq: number;
  kind: string;
  startDate: string;
  endDate: string;
}

interface Scope {
  kind: string;
  contractId: string;
  contractPeriodId: string;
  propertyId: string;
  saleAsset: string;
}

interface Props {
  /** Operación y contrato con que se abre (por ejemplo, el alta desde el detalle del contrato). */
  initialKind?: string;
  contractId?: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Renovaciones y prórrogas del contrato, para el honorario de renovación. */
function useRenewalPeriods(contractId: string, enabled: boolean): ContractPeriodRow[] {
  const [periods, setPeriods] = useState<ContractPeriodRow[]>([]);
  useEffect(() => {
    if (!enabled || !contractId) {
      setPeriods([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await apiClient<ContractPeriodRow[]>(`/contracts/${contractId}/periods`);
        if (!cancelled) setPeriods((Array.isArray(rows) ? rows : []).filter((p) => p.kind !== ContractPeriodKind.Original));
      } catch {
        if (!cancelled) setPeriods([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId, enabled]);
  return periods;
}

/** Lo que se conserva de lo ya escrito cuando llega una propuesta nueva. */
function keepFrom(prev: FeeDraft | null, preview: FeePreview): Partial<FeeDraft> {
  if (!prev) return {};
  const keep: Partial<FeeDraft> = { shares: prev.shares, staff: prev.staff, notes: prev.notes };
  if (prev.kind === FeeKind.Venta && preview.kind === FeeKind.Venta) {
    Object.assign(keep, { baseAmount: prev.baseAmount, currency: prev.currency, payers: prev.payers });
  }
  return keep;
}

/**
 * Alta de un honorario: se elige la operación y su contrato o propiedad, la API propone los valores por defecto
 * de la inmobiliaria (base, porcentaje, quién paga, IVA, cuotas) y todo queda editable antes de guardar. Se crea
 * un honorario por cada uno que paga.
 */
export function FeeCreateDialog({ initialKind = FeeKind.AltaAlquiler, contractId = '', onClose, onSaved }: Props) {
  const t = useTranslations('fees.create');
  const tFees = useTranslations('fees');
  const tCommon = useTranslations('common');
  const targets = useChargeTargets(true);
  const users = useStaffUsers(true);
  const [scope, setScope] = useState<Scope>({
    kind: initialKind,
    contractId,
    contractPeriodId: '',
    propertyId: '',
    saleAsset: '',
  });
  const rental = isRentalKind(scope.kind);
  const periods = useRenewalPeriods(scope.contractId, rental && scope.kind === FeeKind.Renovacion);
  const [draft, setDraft] = useState<FeeDraft | null>(null);
  const [total, setTotal] = useState<FeePreview['contractTotal'] | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (rental && !scope.contractId) {
      setDraft(null);
      setTotal(null);
      return;
    }
    const params = new URLSearchParams({ kind: scope.kind });
    if (rental) {
      if (scope.contractPeriodId) params.set('contractPeriodId', scope.contractPeriodId);
      else params.set('contractId', scope.contractId);
    } else {
      if (scope.propertyId) params.set('propertyId', scope.propertyId);
      if (scope.kind === FeeKind.Venta && scope.saleAsset) params.set('saleAsset', scope.saleAsset);
    }
    let cancelled = false;
    setLoading(true);
    setPreviewError(null);
    void (async () => {
      try {
        const preview = await apiClient<FeePreview>(`/fees/preview?${params.toString()}`);
        if (cancelled) return;
        setDraft((prev) => draftFromPreview(preview, keepFrom(prev, preview)));
        setTotal(preview.contractTotal ?? null);
      } catch (err) {
        if (cancelled) return;
        setPreviewError(err);
        setDraft(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rental, scope.kind, scope.contractId, scope.contractPeriodId, scope.propertyId, scope.saleAsset]);

  const putScope = (patch: Partial<Scope>) => setScope((prev) => ({ ...prev, ...patch }));
  const putDraft = (patch: Partial<FeeDraft>) => {
    setFieldError(null);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  async function save() {
    if (!draft) return;
    const check = checkDraft(draft);
    if (!check.ok) {
      setFieldError(check.field);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiClient<{ items: unknown[] }>('/fees', { method: 'POST', body: JSON.stringify(check.body) });
      toast.success(t('saved', { count: res?.items?.length ?? 1 }));
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  const contractOptions =
    scope.contractId && !targets.contracts.some((c) => c.id === scope.contractId)
      ? [{ id: scope.contractId, label: t('thisContract') }, ...targets.contracts]
      : targets.contracts;

  return (
    <Dialog open onClose={onClose} busy={saving} size="lg">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
      </DialogHeader>
      <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('kind')}>
            {(c) => (
              <Select {...c} value={scope.kind} onChange={(e) => putScope({ kind: e.target.value, contractPeriodId: '' })}>
                {FEE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {tFees(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {rental ? (
            <FormField label={t('contract')}>
              {(c) => (
                <Select {...c} value={scope.contractId} onChange={(e) => putScope({ contractId: e.target.value, contractPeriodId: '' })}>
                  <option value="">{t('chooseContract')}</option>
                  {contractOptions.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : (
            <FormField label={t('property')} hint={scope.kind === FeeKind.Venta ? undefined : t('propertyHint')}>
              {(c) => (
                <Select {...c} value={scope.propertyId} onChange={(e) => putScope({ propertyId: e.target.value })}>
                  <option value="">{t('noProperty')}</option>
                  {targets.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {scope.kind === FeeKind.Renovacion && scope.contractId && (
            <FormField label={t('period')} hint={periods.length === 0 ? t('noRenewals') : undefined}>
              {(c) => (
                <Select {...c} value={scope.contractPeriodId} onChange={(e) => putScope({ contractPeriodId: e.target.value })}>
                  <option value="">{t('firstPeriod')}</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t('periodOption', { seq: p.seq, start: p.startDate.slice(0, 10), end: p.endDate.slice(0, 10) })}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {scope.kind === FeeKind.Venta && (
            <FormField label={t('saleAsset')}>
              {(c) => (
                <Select {...c} value={scope.saleAsset} onChange={(e) => putScope({ saleAsset: e.target.value })}>
                  <option value="">{t('saleAssetAuto')}</option>
                  {Object.values(SaleAsset).map((a) => (
                    <option key={a} value={a}>
                      {tFees(`saleAssets.${a}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
        </div>

        {targets.error != null && <ErrorNotice error={targets.error} fallback={t('targetsError')} />}
        {previewError != null && <ErrorNotice error={previewError} fallback={t('previewError')} />}
        {rental && !scope.contractId && <p className="text-sm text-[var(--color-muted)]">{t('pickContract')}</p>}
        {loading && !draft && <Skeleton className="h-40 w-full" />}
        {total && draft && (
          <p className="text-sm text-[var(--color-muted)]">
            {t('contractTotal', {
              months: total.months,
              start: total.start,
              end: total.end,
              rent: formatMoney(total.initialRent, draft.currency, { decimals: 2 }),
            })}{' '}
            {t(`contractTotalModes.${total.mode}`)}
            {total.indexBased ? ` ${t('indexBased')}` : ''}
          </p>
        )}
        {draft && <FeeDraftEditor draft={draft} onChange={putDraft} users={users} />}
        {fieldError && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {tFees.has(`errors.${fieldError}`) ? tFees(`errors.${fieldError}`) : tFees('errors.form')}
          </p>
        )}
        {saveError != null && <ErrorNotice error={saveError} fallback={t('saveError')} />}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          {tCommon('cancel')}
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving || !draft || loading}>
          {saving ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
