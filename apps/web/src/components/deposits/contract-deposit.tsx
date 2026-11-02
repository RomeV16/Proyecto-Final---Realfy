'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { parsePositiveAmount } from '@/lib/cash';
import {
  DEPOSIT_CURRENCIES,
  HOLDERS,
  REFUND_RULES,
  type ContractDepositData,
  type DepositResponse,
} from '@/lib/deposits';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MoveOutWizard } from './move-out-wizard';

interface Lessor {
  personId: string;
  person: { firstName: string; lastName: string };
}

interface Props {
  contractId: string;
  status: string;
  rentCurrency: string;
  lessors: Lessor[];
}

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/** Depósito en garantía del contrato: importe, moneda, quién lo guarda, cuotas y regla de devolución, y la liquidación de egreso. */
export function ContractDeposit({ contractId, status, rentCurrency, lessors }: Props) {
  const t = useTranslations('deposits');
  const canView = useCan('deposits.view');
  const canManage = useCan('deposits.manage');
  const canCollect = useCan('deposits.collect');
  const [data, setData] = useState<DepositResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<'' | 'edit' | 'moveOut'>('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiClient<DepositResponse>(`/contracts/${contractId}/deposit`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [contractId]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  if (!canView) return null;
  const deposit = data?.deposit ?? null;
  const closed = deposit?.status === 'Devuelto';
  const canMoveOut = canManage && (status === 'Activo' || status === 'Vencido');

  async function collect(number: number) {
    setBusy(number);
    try {
      await apiClient(`/contracts/${contractId}/deposit/installments/${number}/collect`, { method: 'POST', body: JSON.stringify({}) });
      toast.success(t('collected'));
      await load();
    } catch {
      toast.error(t('collectError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      id="deposito"
      aria-labelledby="contract-deposit-title"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="contract-deposit-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('card.title')}
        </h2>
        {deposit && (
          <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-text)]">
            {t(`status.${deposit.status}`)}
          </span>
        )}
      </div>

      {failed && <p className="mt-3 text-sm text-[var(--color-muted)]">{t('card.loadError')}</p>}
      {!failed && data && !deposit && <p className="mt-3 text-sm text-[var(--color-muted)]">{t('card.none')}</p>}

      {deposit && (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--color-muted)]">{t('card.amount')}</dt>
              <dd className="font-medium text-[var(--color-text)]">
                <MoneyText value={deposit.amount} currency={deposit.currency} decimals={2} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted)]">{t('card.heldBy')}</dt>
              <dd className="font-medium text-[var(--color-text)]">
                {t(`holder.${deposit.heldBy}`)}
                {deposit.heldByPerson ? ` · ${name(deposit.heldByPerson)}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted)]">{t('card.refundRule')}</dt>
              <dd className="font-medium text-[var(--color-text)]">
                {t(`rule.${deposit.refundRule}`)}
                <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">
                  ({t('card.refundTerms', { days: deposit.refundDueDays, count: deposit.refundInstallments })})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted)]">{t('card.collected')}</dt>
              <dd className="font-medium text-[var(--color-text)]">
                <MoneyText value={deposit.collectedAmount} currency={deposit.currency} decimals={2} />
              </dd>
            </div>
            {closed && deposit.refundedAt && (
              <div>
                <dt className="text-xs text-[var(--color-muted)]">{t('card.refunded')}</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  <MoneyText value={deposit.refundedAmount} currency={deposit.currency} decimals={2} /> · <DateText value={deposit.refundedAt} />
                </dd>
              </div>
            )}
          </dl>

          <ul className="mt-4 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] text-sm" aria-label={t('card.installments')}>
            {deposit.installmentRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="text-[var(--color-text)]">{t('card.installment', { number: row.number, total: deposit.installments })}</span>
                <DateText value={row.dueDate} />
                <MoneyText value={row.amount} currency={deposit.currency} decimals={2} className="tabular-nums" />
                {row.paidAt ? (
                  <span className="ml-auto text-xs text-[var(--color-muted)]">
                    {t('card.paidOn')} <DateText value={row.paidAt} />
                  </span>
                ) : (
                  canCollect &&
                  !closed && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="ml-auto"
                      disabled={busy !== null}
                      onClick={() => void collect(row.number)}
                    >
                      {t('card.collect')}
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {(canManage || canMoveOut) && data && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canManage && !closed && (
            <Button type="button" variant="secondary" onClick={() => setDialog('edit')}>
              {deposit ? t('card.edit') : t('card.add')}
            </Button>
          )}
          {canMoveOut && (
            <Button type="button" onClick={() => setDialog('moveOut')}>
              {t('card.moveOut')}
            </Button>
          )}
        </div>
      )}

      {dialog === 'edit' && data && (
        <DepositDialog
          contractId={contractId}
          deposit={deposit}
          defaults={data.defaults}
          rentCurrency={rentCurrency}
          lessors={lessors}
          onClose={() => setDialog('')}
          onSaved={() => void load()}
        />
      )}
      {dialog === 'moveOut' && (
        <MoveOutWizard
          contractId={contractId}
          onClose={() => setDialog('')}
          onDone={() => void load()}
        />
      )}
    </section>
  );
}

interface DialogProps {
  contractId: string;
  deposit: ContractDepositData | null;
  defaults: DepositResponse['defaults'];
  rentCurrency: string;
  lessors: Lessor[];
  onClose: () => void;
  onSaved: () => void;
}

function DepositDialog({ contractId, deposit, defaults, rentCurrency, lessors, onClose, onSaved }: DialogProps) {
  const t = useTranslations('deposits');
  const tCommon = useTranslations('common');
  const locked = (deposit?.installmentRows ?? []).some((r) => r.paidAt);
  const [amount, setAmount] = useState(deposit ? String(Number(deposit.amount)) : '');
  const [currency, setCurrency] = useState(deposit?.currency ?? rentCurrency);
  const [heldBy, setHeldBy] = useState<string>(deposit?.heldBy ?? defaults.defaultHeldBy);
  const [holder, setHolder] = useState(deposit?.heldByPersonId ?? lessors[0]?.personId ?? '');
  const [installments, setInstallments] = useState(String(deposit?.installments ?? 1));
  const [rule, setRule] = useState<string>(deposit?.refundRule ?? (currency === 'ARS' ? 'PesosActualizado' : 'MismaMoneda'));
  const [refundInstallments, setRefundInstallments] = useState(String(deposit?.refundInstallments ?? 1));
  const [dueDays, setDueDays] = useState(String(deposit?.refundDueDays ?? defaults.refundDueDays));
  const [notes, setNotes] = useState(deposit?.notes ?? '');
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState('');
  const [saving, setSaving] = useState(false);

  function changeCurrency(next: string) {
    setCurrency(next);
    if (next !== 'ARS' && rule === 'PesosActualizado') setRule('MismaMoneda');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parsePositiveAmount(amount);
    if (!parsed) {
      setFieldError(t('dialog.amountInvalid'));
      return;
    }
    setFieldError('');
    setSaving(true);
    setError(null);
    try {
      await apiClient(`/contracts/${contractId}/deposit`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: parsed,
          currency,
          heldBy,
          heldByPersonId: holder || null,
          installments: Number(installments),
          refundRule: rule,
          refundInstallments: Number(refundInstallments),
          refundDueDays: Number(dueDays),
          notes: notes.trim() || null,
        }),
      });
      toast.success(t('dialog.saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={saving} size="lg">
      <form onSubmit={(e) => void save(e)} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('dialog.title')}</h2>
          {locked && <p className="mt-1 text-sm text-[var(--color-muted)]">{t('dialog.locked')}</p>}
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error != null && <ErrorNotice error={error} fallback={t('dialog.saveError')} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label={t('dialog.amount')} error={fieldError} required className="sm:col-span-2">
              {(c) => <Input {...c} inputMode="decimal" value={amount} disabled={locked} onChange={(e) => setAmount(e.target.value)} />}
            </FormField>
            <FormField label={t('dialog.currency')}>
              {(c) => (
                <Select {...c} value={currency} disabled={locked} onChange={(e) => changeCurrency(e.target.value)}>
                  {DEPOSIT_CURRENCIES.map((cur) => (
                    <option key={cur} value={cur}>
                      {cur}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('dialog.heldBy')}>
              {(c) => (
                <Select {...c} value={heldBy} disabled={locked} onChange={(e) => setHeldBy(e.target.value)}>
                  {HOLDERS.map((h) => (
                    <option key={h} value={h}>
                      {t(`holder.${h}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('dialog.holderPerson')} hint={heldBy === 'Inmobiliaria' ? t('dialog.holderCustodyHint') : undefined} className="sm:col-span-2">
              {(c) => (
                <Select {...c} value={holder} onChange={(e) => setHolder(e.target.value)}>
                  {heldBy === 'Inmobiliaria' && <option value="">{t('dialog.noHolder')}</option>}
                  {lessors.map((l) => (
                    <option key={l.personId} value={l.personId}>
                      {name(l.person)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('dialog.installments')}>
              {(c) => <Input {...c} type="number" min={1} max={24} value={installments} disabled={locked} onChange={(e) => setInstallments(e.target.value)} />}
            </FormField>
            <FormField label={t('dialog.refundRule')} hint={t('dialog.refundRuleHint')}>
              {(c) => (
                <Select {...c} value={rule} onChange={(e) => setRule(e.target.value)}>
                  {REFUND_RULES.filter((r) => r === 'MismaMoneda' || currency === 'ARS').map((r) => (
                    <option key={r} value={r}>
                      {t(`rule.${r}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('dialog.refundInstallments')}>
              {(c) => <Input {...c} type="number" min={1} max={24} value={refundInstallments} onChange={(e) => setRefundInstallments(e.target.value)} />}
            </FormField>
            <FormField label={t('dialog.refundDueDays')} hint={t('dialog.refundDueDaysHint')}>
              {(c) => <Input {...c} type="number" min={0} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />}
            </FormField>
          </div>
          <FormField label={t('dialog.notes')}>
            {(c) => <Textarea {...c} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('dialog.saving') : t('dialog.save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
