'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Currency, FeeBasis, FeePayerRole, FeeVatMode } from '@realfy/shared';
import {
  FEE_PAYER_MODES,
  FEE_PAYER_ROLES,
  FEE_VAT_MODES,
  draftEstimate,
  isRentalKind,
  newRowKey,
  type DraftPayer,
  type FeeDraft,
} from '@/lib/fees';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PersonPicker } from '@/components/parties/person-picker';
import { personName } from '@/components/parties/parties';
import { CounterpartyInput, PctInput, StaffSelect } from './fee-inputs';
import type { StaffUserOption } from './use-staff-users';

const BASES = Object.values(FeeBasis);
const CURRENCIES = Object.values(Currency);

interface Props {
  draft: FeeDraft;
  onChange: (patch: Partial<FeeDraft>) => void;
  users: StaffUserOption[];
}

/** Lista editable: cambia, agrega o quita una fila. */
function rows<T>(list: T[], onChange: (next: T[]) => void) {
  return {
    put: (i: number, patch: Partial<T>) => onChange(list.map((row, j) => (j === i ? { ...row, ...patch } : row))),
    add: (row: T) => onChange([...list, row]),
    remove: (i: number) => onChange(list.filter((_, j) => j !== i)),
  };
}

/** Importe estimado de una fila y el botón para quitarla. */
function RowTail({ amount, money, onRemove }: { amount?: string; money: (value: string) => string; onRemove: () => void }) {
  const t = useTranslations('fees.create');
  return (
    <>
      {amount && <span className="text-sm text-[var(--color-muted)]">{money(amount)}</span>}
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
        {t('remove')}
      </Button>
    </>
  );
}

/**
 * La propuesta del honorario, toda editable: base y porcentaje, quiénes pagan y su parte, IVA, cuotas, coorretaje
 * y comisiones del personal, con la estimación en vivo de lo que paga cada uno.
 */
export function FeeDraftEditor({ draft, onChange, users }: Props) {
  const t = useTranslations('fees.create');
  const tFees = useTranslations('fees');
  const [newRole, setNewRole] = useState<string>(FeePayerRole.Comprador);
  const estimate = draftEstimate(draft);
  const payers = rows(draft.payers, (next) => onChange({ payers: next }));
  const shares = rows(draft.shares, (next) => onChange({ shares: next }));
  const staff = rows(draft.staff, (next) => onChange({ staff: next }));
  const split = draft.payerMode === 'Reparto' && draft.payers.length > 1;
  const money = (value: string) => formatMoney(value, draft.currency, { decimals: 2 });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label={t('basis')}>
          {(c) => (
            <Select {...c} value={draft.basis} onChange={(e) => onChange({ basis: e.target.value })}>
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {tFees(`bases.${b}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={draft.basis === FeeBasis.MontoFijo ? t('fixedAmount') : t('baseAmount')}>
          {(c) => <Input {...c} inputMode="decimal" value={draft.baseAmount} onChange={(e) => onChange({ baseAmount: e.target.value })} />}
        </FormField>
        {draft.basis !== FeeBasis.MontoFijo && (
          <FormField label={t('pct')}>
            {(c) => <Input {...c} inputMode="decimal" value={draft.pct} onChange={(e) => onChange({ pct: e.target.value })} />}
          </FormField>
        )}
        <FormField label={t('currency')}>
          {(c) => (
            <Select {...c} value={draft.currency} onChange={(e) => onChange({ currency: e.target.value })}>
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-[var(--color-text)]">{t('payers')}</legend>
        <FormField label={t('payerMode')} hint={t(`payerModeHints.${draft.payerMode}`)}>
          {(c) => (
            <Select {...c} value={draft.payerMode} onChange={(e) => onChange({ payerMode: e.target.value })} className="sm:w-64">
              {FEE_PAYER_MODES.map((m) => (
                <option key={m} value={m}>
                  {tFees(`payerModes.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {draft.payers.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('noPayers')}</p>}
        <ul className="space-y-2">
          {draft.payers.map((p: DraftPayer, i) => (
            <li key={`${p.role}-${p.personId}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-48 font-medium text-[var(--color-text)]">
                {p.name} · {tFees(`roles.${p.role}`)}
              </span>
              {split && (
                <Input
                  aria-label={t('sharePctOf', { name: p.name })}
                  inputMode="decimal"
                  value={p.sharePct}
                  onChange={(e) => payers.put(i, { sharePct: e.target.value })}
                  className="w-24"
                />
              )}
              {estimate?.payers[i] && (
                <span className="text-[var(--color-muted)]">
                  {t('payerEstimate', {
                    total: money(estimate.payers[i].total),
                    count: Number(draft.installments),
                    installment: money(estimate.payers[i].installment),
                  })}
                </span>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => payers.remove(i)} aria-label={t('removePayer', { name: p.name })}>
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
        {split && !estimate && <p className="text-sm text-[var(--color-warning)]">{t('sharesMustAdd')}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr]">
          <FormField label={t('newPayerRole')}>
            {(c) => (
              <Select {...c} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {FEE_PAYER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tFees(`roles.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <PersonPicker
            label={t('newPayer')}
            value={null}
            excludeIds={draft.payers.filter((p) => p.role === newRole).map((p) => p.personId)}
            onChange={(person) => {
              if (person) payers.add({ role: newRole, personId: person.id, name: personName(person), sharePct: '' });
            }}
          />
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label={t('vatMode')}>
          {(c) => (
            <Select {...c} value={draft.vatMode} onChange={(e) => onChange({ vatMode: e.target.value })}>
              {FEE_VAT_MODES.map((m) => (
                <option key={m} value={m}>
                  {tFees(`vatModes.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {draft.vatMode !== FeeVatMode.NoAplica && (
          <FormField label={t('vatPct')}>
            {(c) => <Input {...c} inputMode="decimal" value={draft.vatPct} onChange={(e) => onChange({ vatPct: e.target.value })} />}
          </FormField>
        )}
        <FormField label={t('installments')}>
          {(c) => <Input {...c} inputMode="numeric" value={draft.installments} onChange={(e) => onChange({ installments: e.target.value })} />}
        </FormField>
        <FormField label={t('firstDueDate')}>
          {(c) => <Input {...c} type="date" value={draft.firstDueDate} onChange={(e) => onChange({ firstDueDate: e.target.value })} />}
        </FormField>
      </div>
      {isRentalKind(draft.kind) && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            checked={draft.adjustInstallments}
            onChange={(e) => onChange({ adjustInstallments: e.target.checked })}
          />
          <span>
            <span className="block font-medium">{t('adjustInstallments')}</span>
            <span className="block text-[var(--color-muted)]">{t('adjustInstallmentsHint')}</span>
          </span>
        </label>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-[var(--color-text)]">{t('shares')}</legend>
        <p className="text-xs text-[var(--color-muted)]">{t('sharesHint')}</p>
        {draft.shares.map((s, i) => (
          <div key={s.key} className="flex flex-wrap items-center gap-2">
            <CounterpartyInput value={s.counterparty} onChange={(counterparty) => shares.put(i, { counterparty })} />
            <PctInput label={t('sharePct')} value={s.pct} onChange={(pct) => shares.put(i, { pct })} />
            <RowTail amount={estimate?.shares[i]} money={money} onRemove={() => shares.remove(i)} />
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => shares.add({ key: newRowKey(), counterparty: '', pct: '' })}>
          {t('addShare')}
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-[var(--color-text)]">{t('staff')}</legend>
        <p className="text-xs text-[var(--color-muted)]">{t(`staffHints.${draft.staffCommissionBase}`)}</p>
        {draft.staff.map((s, i) => (
          <div key={s.key} className="flex flex-wrap items-center gap-2">
            <StaffSelect users={users} value={s.userId} onChange={(userId) => staff.put(i, { userId })} />
            <PctInput label={t('staffPct')} value={s.pct} onChange={(pct) => staff.put(i, { pct })} />
            <RowTail amount={estimate?.staff[i]} money={money} onRemove={() => staff.remove(i)} />
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => staff.add({ key: newRowKey(), userId: '', pct: draft.staffCommissionPct })}>
          {t('addStaff')}
        </Button>
      </fieldset>

      <FormField label={t('notes')}>
        {(c) => <Textarea {...c} rows={2} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />}
      </FormField>

      {estimate && (
        <p className="rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-text)]">
          {t('estimateNet', { net: money(estimate.net) })}
        </p>
      )}
    </div>
  );
}
