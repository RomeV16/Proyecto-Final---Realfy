'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LessorCapacity } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PersonPicker } from './person-picker';
import {
  checkShares,
  draftFromLessor,
  emptyDraft,
  equalShares,
  formatUnitsPct,
  lessorRowErrors,
  lessorsPayload,
  normalizePct,
  personName,
  powerCollectsFor,
  type BankAccount,
  type ContractLessor,
  type ContractWindow,
  type LessorDraft,
  type PartyPerson,
  type PowerOfAttorney,
} from './parties';

export interface LessorsEditorContract extends ContractWindow {
  id: string;
  propertyId?: string | null;
}

interface LessorsEditorProps {
  open: boolean;
  onClose: () => void;
  contract: LessorsEditorContract;
  /** Locadores guardados; si no hay, se parte de `legacyOwners` con reparto igual. */
  lessors: ContractLessor[];
  legacyOwners: PartyPerson[];
  onSaved: () => void;
}

interface PersonResources {
  powers: PowerOfAttorney[];
  accounts: BankAccount[];
}

function initialDrafts(lessors: ContractLessor[], legacyOwners: PartyPerson[]): LessorDraft[] {
  if (lessors.length > 0) return lessors.map(draftFromLessor);
  if (legacyOwners.length > 0) {
    const shares = equalShares(legacyOwners.length);
    return legacyOwners.map((person, i) => emptyDraft({ person, payoutPct: shares[i] }));
  }
  return [emptyDraft()];
}

function accountLabel(a: BankAccount): string {
  return [a.currency, a.bankName, a.alias ?? a.cbu?.slice(-6)].filter(Boolean).join(' · ');
}

/** Días que no cierran en 100 %, de un `LESSOR_SHARES_INVALID` (la API los manda en `details.invalidDates`). */
function invalidDatesOf(error: unknown): { date: string; sum: string }[] | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const nested = (error.details.details as { invalidDates?: unknown } | undefined)?.invalidDates;
  const found = nested ?? error.details.invalidDates;
  return Array.isArray(found) ? (found as { date: string; sum: string }[]) : undefined;
}

/** Editor del conjunto completo de locadores: se guarda de una vez con `PUT /contracts/:id/lessors`. */
export function LessorsEditor({ open, onClose, contract, lessors, legacyOwners, onSaved }: LessorsEditorProps) {
  const t = useTranslations('parties.lessors');
  const tCap = useTranslations('parties.capacity');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [drafts, setDrafts] = useState<LessorDraft[]>([]);
  const [resources, setResources] = useState<Record<string, PersonResources>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDrafts(initialDrafts(lessors, legacyOwners));
    setError(null);
    setTouched(false);
    // Se parte de lo guardado cada vez que se abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Poderes y cuentas de cada locador, para limitar las opciones de cobrador y de cuenta.
  const personIds = useMemo(
    () => [...new Set(drafts.map((d) => d.person?.id).filter((id): id is string => Boolean(id)))],
    [drafts],
  );
  useEffect(() => {
    for (const id of personIds) {
      if (resources[id]) continue;
      setResources((prev) => ({ ...prev, [id]: { powers: [], accounts: [] } }));
      const today = new Date().toISOString().slice(0, 10);
      Promise.all([
        apiClient<PowerOfAttorney[]>(`/persons/${id}/powers?activeOn=${today}`).catch(() => []),
        apiClient<BankAccount[]>(`/persons/${id}/bank-accounts`).catch(() => []),
      ]).then(([powers, accounts]) =>
        setResources((prev) => ({
          ...prev,
          [id]: { powers: Array.isArray(powers) ? powers : [], accounts: Array.isArray(accounts) ? accounts : [] },
        })),
      );
    }
  }, [personIds, resources]);

  const check = checkShares(drafts, contract);
  const rowErrors = lessorRowErrors(drafts);
  const canSave = check.ok && Object.keys(rowErrors).length === 0 && !saving;

  function update(key: string, patch: Partial<LessorDraft>) {
    setTouched(true);
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function remove(key: string) {
    setTouched(true);
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function splitEqually() {
    setTouched(true);
    setDrafts((prev) => {
      const shares = equalShares(prev.length);
      return prev.map((d, i) => ({ ...d, payoutPct: shares[i] }));
    });
  }

  async function save() {
    setTouched(true);
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient(`/contracts/${contract.id}/lessors`, {
        method: 'PUT',
        body: JSON.stringify(lessorsPayload(drafts)),
      });
      toast.success(t('saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const exact = check.ok && check.missing === 0 && check.invalidDates.length === 0;
  const diff = formatUnitsPct(Math.abs(check.missing));
  const apiDates = invalidDatesOf(error);

  return (
    <Dialog open={open} onClose={onClose} busy={saving} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('editorTitle')}</h2>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-5 overflow-y-auto">
          <p className="text-sm text-[var(--color-muted)]">{t('editorHint')}</p>

          {drafts.map((d, index) => {
            const res = d.person ? resources[d.person.id] : undefined;
            const payees = (res?.powers ?? [])
              .filter((p) => powerCollectsFor(p, d.person!.id, contract))
              .map((p) => p.agent)
              .filter((a): a is PartyPerson => Boolean(a));
            const uniquePayees = payees.filter((a, i) => payees.findIndex((b) => b.id === a.id) === i);
            const errs = rowErrors[index] ?? {};
            const pctInvalid = d.payoutPct !== '' && normalizePct(d.payoutPct) === null;
            const name = d.person ? personName(d.person) : t('newLessor', { n: index + 1 });
            return (
              <fieldset key={d.key} className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
                <legend className="px-1 text-sm font-semibold text-[var(--color-text)]">{name}</legend>
                <PersonPicker
                  label={t('fields.person')}
                  value={d.person}
                  onChange={(person) => update(d.key, { person, payeePersonId: '', bankAccountId: '' })}
                  error={touched && errs.personId ? t('errors.person') : undefined}
                  excludeIds={drafts.map((x) => x.person?.id).filter((id): id is string => Boolean(id) && id !== d.person?.id)}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label={t('fields.capacity')}>
                    {(c) => (
                      <Select {...c} value={d.capacity} onChange={(e) => update(d.key, { capacity: e.target.value })}>
                        {Object.values(LessorCapacity).map((cap) => (
                          <option key={cap} value={cap}>
                            {tCap(cap)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField
                    label={t('fields.payoutPct')}
                    required
                    error={pctInvalid || (touched && errs.payoutPct) ? t('errors.payoutPct') : undefined}
                  >
                    {(c) => (
                      <Input
                        {...c}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="50,0000"
                        value={d.payoutPct}
                        onChange={(e) => update(d.key, { payoutPct: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('fields.payee')} hint={d.person ? t('payeeHint') : undefined}>
                    {(c) => (
                      <Select
                        {...c}
                        value={d.payeePersonId}
                        disabled={!d.person}
                        onChange={(e) => update(d.key, { payeePersonId: e.target.value })}
                      >
                        <option value="">{t('payeeSelf')}</option>
                        {uniquePayees.map((a) => (
                          <option key={a.id} value={a.id}>
                            {personName(a)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label={t('fields.bankAccount')}>
                    {(c) => (
                      <Select
                        {...c}
                        value={d.bankAccountId}
                        disabled={!d.person}
                        onChange={(e) => update(d.key, { bankAccountId: e.target.value })}
                      >
                        <option value="">{t('noAccount')}</option>
                        {(res?.accounts ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {accountLabel(a)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label={t('fields.validFrom')} hint={t('validFromHint')}>
                    {(c) => (
                      <Input {...c} type="date" value={d.validFrom} onChange={(e) => update(d.key, { validFrom: e.target.value })} />
                    )}
                  </FormField>
                  <FormField
                    label={t('fields.validTo')}
                    error={d.validFrom && d.validTo && d.validTo <= d.validFrom ? t('errors.validTo') : undefined}
                  >
                    {(c) => (
                      <Input {...c} type="date" value={d.validTo} onChange={(e) => update(d.key, { validTo: e.target.value })} />
                    )}
                  </FormField>
                </div>
                {drafts.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(d.key)}>
                    {t('remove', { name })}
                  </Button>
                )}
              </fieldset>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setTouched(true);
                setDrafts((prev) => [...prev, emptyDraft()]);
              }}
            >
              {t('add')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={splitEqually} disabled={drafts.length < 2}>
              {t('splitEqually')}
            </Button>
          </div>

          <div
            role="status"
            aria-live="polite"
            className={
              exact
                ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
                : 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'
            }
          >
            <p className="font-medium">{t('sum', { sum: formatUnitsPct(check.units) })}</p>
            {exact && <p>{t('sumOk')}</p>}
            {!exact && check.incomplete && <p>{t('sumIncomplete')}</p>}
            {!check.incomplete && check.missing > 0 && <p>{t('sumMissing', { diff })}</p>}
            {!check.incomplete && check.missing < 0 && <p>{t('sumExtra', { diff })}</p>}
            {!check.incomplete && check.missing === 0 && check.invalidDates.length > 0 && <p>{t('sumDatesOnly')}</p>}
            {check.invalidDates.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {check.invalidDates.slice(0, 5).map((d) => (
                  <li key={d.date.toISOString()}>
                    {t('invalidDate', { date: formatDate(d.date, 'numeric', locale), sum: d.sum.replace('.', ',') })}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error != null && (
            <div className="space-y-2">
              <ErrorNotice error={error} fallback={t('saveError')} />
              {apiDates && apiDates.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-[var(--color-danger)]">
                  {apiDates.map((d) => (
                    <li key={d.date}>
                      {t('invalidDate', { date: formatDate(d.date, 'numeric', locale), sum: d.sum.replace('.', ',') })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {saving ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
