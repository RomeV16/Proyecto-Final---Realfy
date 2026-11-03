'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LESSOR_INVOICE_VAT_RATES, LessorInvoiceScope, LessorInvoiceWhen } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { INHERIT, overrideBody, type LessorInvoicingState } from '@/lib/lessor-invoicing';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorText } from '@/components/cash/use-cash-data';

const DELEGATION_TONE: Record<string, BadgeVariant> = { Pending: 'warning', Active: 'success', Revoked: 'danger' };

/**
 * Solapa "Facturación" de un locador: su emisor delegado (la inmobiliaria factura con la delegación
 * ARCA del locador, nunca a nombre de la inmobiliaria) y qué, cuándo y con qué IVA se factura.
 */
export function LessorInvoicingTab({ personId }: { personId: string }) {
  const t = useTranslations('lessorInvoicing');
  const errorText = useErrorText();
  const canView = useCan('lessorInvoicing.view');
  const canConfigure = useCan('lessorInvoicing.configure');
  const [state, setState] = useState<LessorInvoicingState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ scope: INHERIT, when: INHERIT, vatPct: INHERIT });

  const apply = useCallback((next: LessorInvoicingState) => {
    setState(next);
    setForm({
      scope: next.override?.scope ?? INHERIT,
      when: next.override?.when ?? INHERIT,
      vatPct: next.override?.vatPct == null ? INHERIT : String(next.override.vatPct),
    });
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await apiClient<LessorInvoicingState>(`/persons/${personId}/invoicing-settings`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [personId, apply]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  if (!canView) return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;
  if (error != null && !state) return <ErrorNotice error={error} fallback={t('loadError')} />;
  if (!state) return <Skeleton className="h-48 w-full" />;

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(errorText(err, failure));
    } finally {
      setBusy(false);
    }
  }

  const issuer = state.issuer;
  const post = (path: string) => apiClient(path, { method: 'POST' });
  const defaultsLabel = (field: 'scope' | 'when' | 'vatPct') => {
    const value = state.agencyDefaults[field];
    if (field === 'vatPct') return value === 0 ? t('vat.zero') : `${value} %`;
    return t(`${field}.${value}`);
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="lessor-issuer" className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 id="lessor-issuer" className="text-sm font-semibold text-[var(--color-text)]">
          {t('issuer.title')}
        </h2>
        <p className="text-sm text-[var(--color-muted)]">{t('issuer.explain')}</p>
        {issuer ? (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--color-muted)]">{t('issuer.name')}</dt>
                <dd>{issuer.businessName}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)]">{t('issuer.cuit')}</dt>
                <dd className="tabular-nums">{issuer.cuit}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)]">{t('issuer.condition')}</dt>
                <dd>{t(`fiscalConditions.${issuer.fiscalCondition}`)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)]">{t('issuer.delegation')}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <Badge variant={DELEGATION_TONE[issuer.delegationStatus] ?? 'neutral'} dot>
                    {t(`delegation.${issuer.delegationStatus}`)}
                  </Badge>
                  {issuer.delegationVerifiedAt && (
                    <span className="text-xs text-[var(--color-muted)]">
                      {t('issuer.verifiedAt', { date: formatDate(issuer.delegationVerifiedAt) })}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {issuer.delegationLastError && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {issuer.delegationLastError}
              </p>
            )}
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text)]">{t('issuer.pdv')}</h3>
              {issuer.puntosDeVenta.length === 0 ? (
                <p className="text-sm italic text-[var(--color-muted)]">{t('issuer.noPdv')}</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-2 text-sm">
                  {issuer.puntosDeVenta.map((p) => (
                    <li key={p.id} className="rounded-md border border-[var(--color-border)] px-2 py-0.5 tabular-nums">
                      {String(p.number).padStart(4, '0')}
                      {p.bloqueado ? ` · ${t('issuer.blocked')}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canConfigure && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => post(`/invoices/issuers/${issuer.id}/verify-delegation`), t('issuer.verified'), t('issuer.verifyError'))
                  }
                >
                  {t('issuer.verify')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => post(`/invoices/issuers/${issuer.id}/sync-pdv`), t('issuer.synced'), t('issuer.syncError'))}
                >
                  {t('issuer.sync')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm italic text-[var(--color-muted)]">{t('issuer.none')}</p>
            {canConfigure && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void run(() => post(`/persons/${personId}/invoicing-issuer`), t('issuer.created'), t('issuer.createError'))}
              >
                {t('issuer.create')}
              </Button>
            )}
          </>
        )}
      </section>

      {issuer && (
        <section aria-labelledby="lessor-settings" className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div>
            <h2 id="lessor-settings" className="text-sm font-semibold text-[var(--color-text)]">
              {t('settings.title')}
            </h2>
            <p className="text-sm text-[var(--color-muted)]">{t('settings.explain')}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label={t('settings.scope')} hint={t('settings.fromAgency', { value: defaultsLabel('scope') })}>
              {(c) => (
                <Select {...c} value={form.scope} disabled={!canConfigure} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                  <option value={INHERIT}>{t('settings.inherit')}</option>
                  {Object.values(LessorInvoiceScope).map((v) => (
                    <option key={v} value={v}>
                      {t(`scope.${v}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('settings.when')} hint={t('settings.fromAgency', { value: defaultsLabel('when') })}>
              {(c) => (
                <Select {...c} value={form.when} disabled={!canConfigure} onChange={(e) => setForm({ ...form, when: e.target.value })}>
                  <option value={INHERIT}>{t('settings.inherit')}</option>
                  {Object.values(LessorInvoiceWhen).map((v) => (
                    <option key={v} value={v}>
                      {t(`when.${v}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('settings.vat')} hint={t('settings.fromAgency', { value: defaultsLabel('vatPct') })}>
              {(c) => (
                <Select {...c} value={form.vatPct} disabled={!canConfigure} onChange={(e) => setForm({ ...form, vatPct: e.target.value })}>
                  <option value={INHERIT}>{t('settings.inherit')}</option>
                  {LESSOR_INVOICE_VAT_RATES.map((v) => (
                    <option key={v} value={String(v)}>
                      {v === 0 ? t('vat.zero') : `${v} %`}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <p className="text-sm text-[var(--color-text)]">
            {t('settings.effective', {
              scope: t(`scope.${state.effective.scope}`),
              when: t(`when.${state.effective.when}`),
              vat: state.effective.vatPct === 0 ? t('vat.zero') : `${state.effective.vatPct} %`,
            })}
          </p>
          {state.autoSince && (
            <p className="text-xs text-[var(--color-muted)]">{t('settings.autoSince', { date: formatDate(state.autoSince) })}</p>
          )}
          <p className="text-xs text-[var(--color-muted)]">{t('settings.fiscalNote')}</p>
          {canConfigure && (
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => apiClient(`/persons/${personId}/invoicing-settings`, { method: 'PUT', body: JSON.stringify(overrideBody(form)) }),
                  t('settings.saved'),
                  t('settings.saveError'),
                )
              }
            >
              {t('settings.save')}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
