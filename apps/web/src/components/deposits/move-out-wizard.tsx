'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MoveOutItem } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { parseRate } from '@/lib/cash';
import {
  ITEM_KINDS,
  moveOutTotals,
  parseSigned,
  type MoveOutPreview,
  type MoveOutSettlementData,
} from '@/lib/deposits';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  contractId: string;
  onClose: () => void;
  /** Se confirmó la liquidación: recarga el depósito y el seguimiento. */
  onDone: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

type Step = 'loading' | 'date' | 'items' | 'done';

/**
 * Liquidación de egreso (el "chequeo"): 1) fecha de egreso, 2) renglones que trae el sistema con casilla para
 * incluirlos y el importe editable, más los descuentos que se agregan a mano, y 3) confirmar, que devuelve el
 * depósito y cierra el paso del seguimiento. Un borrador existente se retoma; uno confirmado solo se baja en PDF.
 */
export function MoveOutWizard({ contractId, onClose, onDone }: Props) {
  const t = useTranslations('deposits.moveOut');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const [step, setStep] = useState<Step>('loading');
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState('');
  const [preview, setPreview] = useState<MoveOutPreview | null>(null);
  const [items, setItems] = useState<MoveOutItem[]>([]);
  const [notes, setNotes] = useState('');
  const [settlement, setSettlement] = useState<MoveOutSettlementData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<{ settlement: (MoveOutSettlementData & { notes?: string | null }) | null }>(`/contracts/${contractId}/move-out`);
        if (cancelled) return;
        if (res?.settlement) {
          setSettlement(res.settlement);
          setStep(res.settlement.status === 'Confirmada' ? 'done' : 'date');
          setDate(res.settlement.date.slice(0, 10));
          setNotes(res.settlement.notes ?? '');
        } else {
          setStep('date');
        }
      } catch {
        if (!cancelled) setStep('date');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  async function load() {
    const parsedRate = rate.trim() ? parseRate(rate) : null;
    if (rate.trim() && !parsedRate) {
      setError(new Error(t('rateInvalid')));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date, ...(parsedRate ? { rate: parsedRate } : {}) });
      const res = await apiClient<MoveOutPreview>(`/contracts/${contractId}/move-out/preview?${qs.toString()}`, { method: 'POST' });
      setPreview(res);
      // Un borrador de la misma fecha conserva lo que el equipo editó.
      setItems(settlement?.status === 'Borrador' && settlement.date.slice(0, 10) === date ? settlement.items : res.items);
      setStep('items');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function edit(index: number, patch: Partial<MoveOutItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  const invalid = items.some((i) => parseSigned(i.amount) === null || !i.description.trim());
  const totals = moveOutTotals(items, preview?.deposit ?? null);
  const currency = preview?.currency ?? 'ARS';

  async function saveDraft() {
    const saved = await apiClient<MoveOutSettlementData>(`/contracts/${contractId}/move-out`, {
      method: 'POST',
      body: JSON.stringify({
        date,
        rate: rate.trim() ? parseRate(rate) : undefined,
        notes: notes.trim() || null,
        items: items.map((i) => ({ ...i, amount: parseSigned(i.amount) })),
      }),
    });
    setSettlement(saved);
    return saved;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const draft = () =>
    run(async () => {
      await saveDraft();
      toast.success(t('draftSaved'));
    });

  const finish = async () => {
    const ok = await confirm({
      title: t('confirm.title'),
      body: t('confirm.body', {
        refund: Number(totals.refundToTenant).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
        owed: Number(totals.owedByTenant).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
        currency,
      }),
      confirmLabel: t('confirm.action'),
    });
    if (!ok) return;
    await run(async () => {
      const saved = await saveDraft();
      const done = await apiClient<MoveOutSettlementData>(`/move-outs/${saved.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      setSettlement(done);
      setStep('done');
      toast.success(t('confirmed'));
      onDone();
    });
  };

  return (
    <Dialog open onClose={onClose} busy={busy} size="lg">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t(`steps.${step === 'loading' ? 'date' : step}`)}</p>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {error != null && <ErrorNotice error={error} fallback={t('error')} />}

        {step === 'loading' && <p className="text-sm text-[var(--color-muted)]">{tCommon('loading')}</p>}

        {step === 'date' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('date')} hint={t('dateHint')} required>
              {(c) => <Input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </FormField>
            <FormField label={t('rate')} hint={t('rateHint')}>
              {(c) => <Input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}
            </FormField>
          </div>
        )}

        {step === 'items' && preview && (
          <>
            {preview.deposit ? (
              <p className="text-sm text-[var(--color-text)]">
                {t('depositLine', { rule: t(`rule.${preview.deposit.refundRule}`) })}{' '}
                <MoneyText value={preview.deposit.refundable} currency={currency} decimals={2} className="font-semibold" />
                {Number(preview.deposit.collected) < Number(preview.deposit.amount) && (
                  <span className="ml-1 text-[var(--color-muted)]">({t('partial')})</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">{t('noDeposit')}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th scope="col" className="w-8 py-1">
                      <span className="sr-only">{t('include')}</span>
                    </th>
                    <th scope="col">{t('kind')}</th>
                    <th scope="col">{t('description')}</th>
                    <th scope="col" className="w-36 text-right">
                      {t('amount')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {items.map((item, index) => (
                    <tr key={`${item.sourceType ?? 'manual'}-${item.sourceId ?? index}`}>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={item.included}
                          aria-label={`${t('include')}: ${item.description}`}
                          onChange={(e) => edit(index, { included: e.target.checked })}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="pr-2 text-[var(--color-muted)]">{t(`kinds.${item.kind}`)}</td>
                      <td className="pr-2">
                        {item.sourceType ? (
                          <span className={item.included ? '' : 'text-[var(--color-muted)] line-through'}>{item.description}</span>
                        ) : (
                          <Input
                            aria-label={t('description')}
                            value={item.description}
                            onChange={(e) => edit(index, { description: e.target.value })}
                          />
                        )}
                      </td>
                      <td>
                        <Input
                          aria-label={`${t('amount')}: ${item.description}`}
                          inputMode="decimal"
                          className="text-right tabular-nums"
                          value={item.amount}
                          aria-invalid={parseSigned(item.amount) === null ? true : undefined}
                          onChange={(e) => edit(index, { amount: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-[var(--color-muted)]">
                        {t('noItems')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setItems((prev) => [...prev, { kind: ITEM_KINDS[ITEM_KINDS.length - 1], description: '', amount: '', included: true }])}
            >
              {t('addDeduction')}
            </Button>

            <dl className="grid grid-cols-1 gap-2 rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-[var(--color-muted)]">{t('totals.owed')}</dt>
                <dd className="font-semibold">
                  <MoneyText value={totals.totalOwed} currency={currency} decimals={2} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-muted)]">{t('totals.deposit')}</dt>
                <dd className="font-semibold">
                  <MoneyText value={totals.depositAvailable} currency={currency} decimals={2} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-muted)]">{Number(totals.net) >= 0 ? t('totals.refund') : t('totals.collect')}</dt>
                <dd className="font-semibold">
                  <MoneyText value={Math.abs(Number(totals.net))} currency={currency} decimals={2} />
                </dd>
              </div>
            </dl>
            <FormField label={t('notes')}>
              {(c) => <Textarea {...c} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </FormField>
          </>
        )}

        {step === 'done' && settlement && (
          <p className="text-sm text-[var(--color-text)]">
            {t('doneBody')}{' '}
            <MoneyText value={Math.abs(Number(settlement.netAmount))} currency={settlement.currency} decimals={2} className="font-semibold" />
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        {settlement && (
          <Button
            type="button"
            variant="secondary"
            className="mr-auto"
            disabled={busy}
            onClick={() =>
              void downloadFile(`/move-outs/${settlement.id}/pdf`, `liquidacion-egreso.pdf`).catch(() => toast.error(t('pdfFailed')))
            }
          >
            {t('pdf')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          {tCommon('close')}
        </Button>
        {step === 'date' && (
          <Button type="button" disabled={busy || !date} onClick={() => void load()}>
            {t('preview')}
          </Button>
        )}
        {step === 'items' && (
          <>
            <Button type="button" variant="secondary" disabled={busy || invalid} onClick={() => void draft()}>
              {t('saveDraft')}
            </Button>
            <Button type="button" disabled={busy || invalid} onClick={() => void finish()}>
              {t('finish')}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
