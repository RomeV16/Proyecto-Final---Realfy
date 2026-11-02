'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  AnnualDiscountBeneficiary,
  AnnualRecovery,
  ChargePayer, ChargeSplitMode,
  RemainingInstallmentsOnEnd,
  ServicePaymentPlan,
} from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/permissions';
import { formatDate, formatMoneyFixed } from '@/lib/format';
import { parseAmountInput, parseDateInput } from '@/lib/service-bills';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { inputStyles } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

/* ──────────── Types ──────────── */

interface RuleService {
  id: string;
  serviceType: string;
  providerName: string | null;
  propertyId: string;
}

interface ChargeRule {
  id: string;
  serviceId: string;
  payer: string;
  splitMode: string;
  tenantSharePct: string;
  fixedAmount: string | null;
  paymentPlan: string;
  annualRecovery: string;
  annualInstallments: number;
  annualDiscountBeneficiary: string;
  remainingInstallmentsOnEnd: string;
  validFrom: string;
  validTo: string | null;
  agreementId: string | null;
  service: RuleService;
}

interface RulesResponse {
  at: string;
  current: ChargeRule[];
  versions: ChargeRule[];
}

interface ServiceOption extends RuleService {
  hasAnnualOption: boolean;
}

interface Props {
  contractId: string;
  propertyId: string;
  /** Un contrato que no es borrador necesita un acuerdo de cambio de cargo para cambiar las reglas. */
  contractStatus: string;
  currency?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Servicios que el contrato puede trasladar: los de su propiedad y los de su edificio. */
async function loadServices(propertyId: string): Promise<ServiceOption[]> {
  const own = await apiClient<{ items: ServiceOption[] }>(`/services?propertyId=${propertyId}&isActive=true&limit=100`);
  let parentId: string | null = null;
  try {
    parentId = (await apiClient<{ parentPropertyId?: string | null }>(`/properties/${propertyId}`)).parentPropertyId ?? null;
  } catch {
    parentId = null;
  }
  if (!parentId) return own.items;
  const building = await apiClient<{ items: ServiceOption[] }>(`/services?propertyId=${parentId}&isActive=true&limit=100`);
  return [...own.items, ...building.items];
}

/**
 * Impuestos y servicios del contrato: las reglas vigentes (quién paga, cómo se reparte, plan de pago) y, para quien
 * administra la facturación, un editor. Una regla nunca se pisa: el cambio es una versión nueva desde una fecha. En un
 * contrato que ya no es borrador el cambio se respalda con un acuerdo de cambio de cargo, que el editor registra junto
 * con la regla.
 */
export function ContractChargeRules({ contractId, propertyId, contractStatus, currency }: Props) {
  const t = useTranslations('chargeRules');
  const tTypes = useTranslations('services.serviceTypes');
  const canEdit = useCan('serviceBills.manage');
  const needsAgreement = contractStatus !== 'Borrador';

  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRules(await apiClient<RulesResponse>(`/contracts/${contractId}/charge-rules`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    loadServices(propertyId)
      .then((list) => !cancelled && setServices(list))
      .catch(() => !cancelled && setServices([]));
    return () => {
      cancelled = true;
    };
  }, [canEdit, propertyId]);

  const serviceName = (service: RuleService) =>
    [tTypes(service.serviceType), service.providerName].filter(Boolean).join(' · ');

  const describeMode = (rule: ChargeRule) =>
    rule.splitMode === 'Porcentaje'
      ? t('modes.Porcentaje', { pct: Number(rule.tenantSharePct) })
      : rule.splitMode === 'Fijo'
        ? t('modes.Fijo', { amount: formatMoneyFixed(rule.fixedAmount, currency) })
        : t('modes.Consumo');

  const describePlan = (rule: ChargeRule) =>
    rule.paymentPlan === 'Anual'
      ? t(`plans.Anual.${rule.annualRecovery}`, { count: rule.annualInstallments })
      : t('plans.Mensual');

  const past = (rules?.versions ?? []).filter((v) => !(rules?.current ?? []).some((c) => c.id === v.id));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contract-charge-rules-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="contract-charge-rules-title" className="text-sm font-semibold text-slate-900">
          {t('title')}
        </h2>
        {canEdit && !editing && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {t('edit')}
          </Button>
        )}
      </div>

      {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
      {error == null && rules === null && <Skeleton className="h-16 w-full" />}
      {rules !== null && rules.current.length === 0 && <p className="text-sm italic text-slate-400">{t('none')}</p>}
      {rules !== null && rules.current.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rules.current.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm">
              <span className="min-w-40 font-medium text-slate-900">{serviceName(rule.service)}</span>
              <Badge variant={rule.payer === 'Inquilino' ? 'neutral' : 'brand'}>{t(`payers.${rule.payer}`)}</Badge>
              {rule.payer !== 'Inquilino' && <span className="text-slate-600">{describeMode(rule)}</span>}
              {rule.payer !== 'Inquilino' && <span className="text-slate-500">{describePlan(rule)}</span>}
              <span className="text-xs text-slate-400">
                {t('since', { date: formatDate(rule.validFrom, 'medium') })}
                {rule.agreementId && ` · ${t('byAgreement')}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">
            {t('history', { count: past.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {past.map((rule) => (
              <li key={rule.id} className="text-slate-600">
                {serviceName(rule.service)}: {t(`payers.${rule.payer}`)}
                {rule.payer !== 'Inquilino' && `, ${describeMode(rule)}`} ·{' '}
                {rule.validTo
                  ? t('range', { from: formatDate(rule.validFrom, 'medium'), to: formatDate(rule.validTo, 'medium') })
                  : t('since', { date: formatDate(rule.validFrom, 'medium') })}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && editing && (
        <RuleEditor
          contractId={contractId}
          services={services}
          needsAgreement={needsAgreement}
          serviceName={serviceName}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

/* ──────────── Editor ──────────── */

function RuleEditor({
  contractId,
  services,
  needsAgreement,
  serviceName,
  onCancel,
  onSaved,
}: {
  contractId: string;
  services: ServiceOption[];
  needsAgreement: boolean;
  serviceName: (service: RuleService) => string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('chargeRules');
  const [serviceId, setServiceId] = useState('');
  const [payer, setPayer] = useState<string>(ChargePayer.Inmobiliaria);
  const [splitMode, setSplitMode] = useState<string>(ChargeSplitMode.Porcentaje);
  const [pct, setPct] = useState('100');
  const [fixed, setFixed] = useState('');
  const [plan, setPlan] = useState<string>(ServicePaymentPlan.Mensual);
  const [recovery, setRecovery] = useState<string>(AnnualRecovery.Prorrateado);
  const [installments, setInstallments] = useState('12');
  const [beneficiary, setBeneficiary] = useState<string>(AnnualDiscountBeneficiary.Inquilino);
  const [onEnd, setOnEnd] = useState<string>(RemainingInstallmentsOnEnd.CobrarEnLiquidacionFinal);
  const [validFrom, setValidFrom] = useState(today);
  const [documentUrl, setDocumentUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ error: unknown; agreementKept: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const direct = payer === ChargePayer.Inquilino;
  const showAnnual = !direct && (service?.hasAnnualOption ?? false);
  const annual = showAnnual && plan === ServicePaymentPlan.Anual;
  const prorated = annual && recovery === AnnualRecovery.Prorrateado;

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!serviceId) found.service = t('validation.service');
    if (parseDateInput(validFrom) === null) found.validFrom = t('validation.date');
    if (!direct && splitMode === ChargeSplitMode.Porcentaje) {
      const value = Number(pct.replace(',', '.'));
      if (pct.trim() === '' || Number.isNaN(value) || value < 0 || value > 100) found.pct = t('validation.pct');
    }
    if (prorated) {
      const n = Number(installments);
      if (!Number.isInteger(n) || n < 1 || n > 12) found.installments = t('validation.installments');
    }
    if (!direct && splitMode === ChargeSplitMode.Fijo) {
      const amount = parseAmountInput(fixed);
      if (amount === null || Number(amount) <= 0) found.fixed = t('validation.fixed');
    }
    if (needsAgreement && documentUrl.trim() !== '' && !/^https?:\/\//i.test(documentUrl.trim())) {
      found.documentUrl = t('validation.url');
    }
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setFailure(null);
    let agreementId: string | undefined;
    try {
      const from = parseDateInput(validFrom) as string;
      if (needsAgreement) {
        const agreement = await apiClient<{ id: string }>(`/contracts/${contractId}/agreements`, {
          method: 'POST',
          body: JSON.stringify({
            kind: 'CambioCargo',
            effectiveFrom: `${from}T00:00:00.000Z`,
            notes: notes.trim() || undefined,
            documentUrl: documentUrl.trim() || undefined,
          }),
        });
        agreementId = agreement.id;
      }
      const percentage = splitMode === ChargeSplitMode.Porcentaje && !direct;
      await apiClient(`/contracts/${contractId}/charge-rules`, {
        method: 'POST',
        body: JSON.stringify({
          serviceId,
          payer,
          // Quien paga directo no cobra nada por la inmobiliaria: la regla solo deja constancia.
          splitMode: direct ? ChargeSplitMode.Porcentaje : splitMode,
          tenantSharePct: percentage ? pct.trim().replace(',', '.') : '100',
          fixedAmount: !direct && splitMode === ChargeSplitMode.Fijo ? parseAmountInput(fixed) : undefined,
          paymentPlan: annual ? ServicePaymentPlan.Anual : ServicePaymentPlan.Mensual,
          annualRecovery: annual ? recovery : undefined,
          annualInstallments: prorated ? Number(installments) : undefined,
          annualDiscountBeneficiary: annual ? beneficiary : undefined,
          remainingInstallmentsOnEnd: prorated ? onEnd : undefined,
          validFrom: from,
          agreementId,
          notes: needsAgreement ? undefined : notes.trim() || undefined,
        }),
      });
      toast.success(t('saved'));
      onSaved();
    } catch (err) {
      setFailure({ error: err, agreementKept: agreementId !== undefined });
      if (!(err instanceof ApiRequestError)) toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4 rounded-lg border border-slate-200 p-4" aria-label={t('editorLabel')}>
      <p className="text-sm text-slate-600">{needsAgreement ? t('agreementNotice') : t('draftNotice')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fields.service')} error={errors.service} required>
          {(control) => (
            <select
              {...control}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={inputStyles({ invalid: !!errors.service })}
            >
              <option value="" />
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {serviceName(s)}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField label={t('fields.payer')} hint={t(`payerHints.${payer}`)}>
          {(control) => (
            <select {...control} value={payer} onChange={(e) => setPayer(e.target.value)} className={inputStyles()}>
              {Object.values(ChargePayer).map((p) => (
                <option key={p} value={p}>
                  {t(`payers.${p}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>

        {!direct && (
          <FormField label={t('fields.splitMode')}>
            {(control) => (
              <select {...control} value={splitMode} onChange={(e) => setSplitMode(e.target.value)} className={inputStyles()}>
                {Object.values(ChargeSplitMode).map((m) => (
                  <option key={m} value={m}>
                    {t(`splitModes.${m}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {!direct && splitMode === ChargeSplitMode.Porcentaje && (
          <FormField label={t('fields.pct')} error={errors.pct} required>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                className={inputStyles({ invalid: !!errors.pct })}
              />
            )}
          </FormField>
        )}

        {!direct && splitMode === ChargeSplitMode.Fijo && (
          <FormField label={t('fields.fixed')} error={errors.fixed} required>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
                className={inputStyles({ invalid: !!errors.fixed })}
              />
            )}
          </FormField>
        )}

        {showAnnual && (
          <FormField label={t('fields.plan')}>
            {(control) => (
              <select {...control} value={plan} onChange={(e) => setPlan(e.target.value)} className={inputStyles()}>
                {Object.values(ServicePaymentPlan).map((p) => (
                  <option key={p} value={p}>
                    {t(`planNames.${p}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {annual && (
          <FormField label={t('fields.recovery')} hint={t(`recoveryHints.${recovery}`)}>
            {(control) => (
              <select {...control} value={recovery} onChange={(e) => setRecovery(e.target.value)} className={inputStyles()}>
                {Object.values(AnnualRecovery).map((r) => (
                  <option key={r} value={r}>
                    {t(`recoveries.${r}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        <FormField label={t('fields.validFrom')} error={errors.validFrom} required>
          {(control) => (
            <input
              {...control}
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className={inputStyles({ invalid: !!errors.validFrom })}
            />
          )}
        </FormField>

        {needsAgreement && (
          <FormField label={t('fields.documentUrl')} error={errors.documentUrl}>
            {(control) => (
              <input
                {...control}
                type="url"
                value={documentUrl}
                onChange={(e) => setDocumentUrl(e.target.value)}
                className={inputStyles({ invalid: !!errors.documentUrl })}
              />
            )}
          </FormField>
        )}
      </div>

      {annual && (
        <div className="grid gap-4 sm:grid-cols-2">
          {prorated && (
            <FormField label={t('fields.installments')} error={errors.installments} hint={t('installmentsHint')} required>
              {(control) => (
                <select
                  {...control}
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  className={inputStyles({ invalid: !!errors.installments })}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
          <FormField label={t('fields.discountBeneficiary')} hint={t(`discountHints.${beneficiary}`)}>
            {(control) => (
              <select {...control} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} className={inputStyles()}>
                {Object.values(AnnualDiscountBeneficiary).map((b) => (
                  <option key={b} value={b}>
                    {t(`discountBeneficiaries.${b}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {prorated && (
            <FormField label={t('fields.onEnd')} hint={t(`onEndHints.${onEnd}`)}>
              {(control) => (
                <select {...control} value={onEnd} onChange={(e) => setOnEnd(e.target.value)} className={inputStyles()}>
                  {Object.values(RemainingInstallmentsOnEnd).map((o) => (
                    <option key={o} value={o}>
                      {t(`onEnd.${o}`)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
        </div>
      )}

      <FormField label={needsAgreement ? t('fields.agreementNotes') : t('fields.notes')}>
        {(control) => (
          <textarea
            {...control}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputStyles({ multiline: true })}
            maxLength={2000}
          />
        )}
      </FormField>

      {failure && (
        <div className="space-y-2">
          <ErrorNotice error={failure.error} fallback={t('saveError')} />
          {failure.agreementKept && <p className="text-xs text-slate-500">{t('agreementKept')}</p>}
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? t('saving') : needsAgreement ? t('saveWithAgreement') : t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
