'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { FeeStatus } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { canCancelFee, feePlace, type Fee, type FeeInstallment } from '@/lib/fees';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useErrorText } from '@/components/cash/use-cash-data';
import { FeePayDialog, type PayTarget } from './fee-pay-dialog';
import { CounterpartyInput, PctInput, StaffSelect } from './fee-inputs';
import { useInstallmentColumns } from './installment-columns';
import { useStaffUsers } from './use-staff-users';

interface Props {
  feeId: string;
  onClose: () => void;
  /** Algo cambió (cobro, anulación, reparto): la lista de afuera vuelve a leer. */
  onChanged: () => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Detalle de un honorario: importes, cuotas (con el cobro), coorretaje y comisiones del personal. Quien gestiona
 * puede sumar o quitar repartos y anularlo mientras no tenga cobros.
 */
export function FeeDetailDialog({ feeId, onClose, onChanged }: Props) {
  const t = useTranslations('fees');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const canManage = useCan('fees.manage');
  const [fee, setFee] = useState<Fee | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<PayTarget | null>(null);
  const [share, setShare] = useState({ counterparty: '', pct: '' });
  const [staff, setStaff] = useState({ userId: '', pct: '' });
  const [reason, setReason] = useState('');
  const editable = canManage && fee !== null && fee.status !== FeeStatus.Anulado;
  const users = useStaffUsers(editable);
  const columns = useInstallmentColumns<FeeInstallment>(() => fee as Fee, setPaying);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await apiClient<Fee>(`/fees/${feeId}`);
        if (!cancelled) {
          setFee(loaded);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feeId, version]);

  /** Corre una acción sobre el honorario; la API devuelve el honorario actualizado. */
  async function act(path: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    try {
      setFee(await apiClient<Fee>(path, init));
      toast.success(done);
      onChanged();
      return true;
    } catch (err) {
      toast.error(errorText(err, t('actionError')));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = (body: object): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

  async function addShare() {
    const ok = await act(`/fees/${feeId}/shares`, post({ counterparty: share.counterparty.trim(), pct: share.pct.replace(',', '.') }), t('detail.shareAdded'));
    if (ok) setShare({ counterparty: '', pct: '' });
  }

  async function addStaff() {
    const ok = await act(`/fees/${feeId}/staff-commissions`, post({ userId: staff.userId, pct: staff.pct.replace(',', '.') }), t('detail.staffAdded'));
    if (ok) setStaff({ userId: '', pct: '' });
  }

  async function cancelFee() {
    const ok = await confirm({
      title: t('detail.cancelTitle'),
      body: t('detail.cancelBody'),
      confirmLabel: t('detail.cancel'),
      tone: 'danger',
    });
    if (ok) await act(`/fees/${feeId}/cancel`, post({ reason: reason.trim() }), t('detail.cancelled'));
  }

  return (
    <>
      <Dialog open onClose={onClose} busy={busy} size="lg">
        <DialogHeader>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                {fee ? t('detail.title', { kind: t(`kinds.${fee.kind}`) }) : t('detail.loading')}
              </h2>
              {fee && <StatusBadge domain="honorario" status={fee.status} />}
            </div>
            {fee && feePlace(fee) && <p className="text-sm text-[var(--color-muted)]">{feePlace(fee)}</p>}
          </div>
        </DialogHeader>
        <DialogBody className="space-y-6">
          {error != null && <ErrorNotice error={error} fallback={t('detail.loadError')} />}
          {fee === null && error == null && <Skeleton className="h-48 w-full" />}
          {fee && (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label={t('detail.payer')}>
                  {fee.payerName} · {t(`roles.${fee.payerRole}`)}
                </Fact>
                <Fact label={t('detail.base')}>
                  <MoneyText value={fee.baseAmount} currency={fee.currency} />
                  {fee.pct !== null && ` · ${fee.pct} %`}
                </Fact>
                <Fact label={t('detail.net')}>
                  <MoneyText value={fee.netAmount} currency={fee.currency} />
                </Fact>
                <Fact label={t('detail.vat')}>
                  <MoneyText value={fee.vatAmount} currency={fee.currency} /> · {t(`vatModes.${fee.vatMode}`)}
                </Fact>
                <Fact label={t('detail.total')}>
                  <MoneyText value={fee.total} currency={fee.currency} />
                </Fact>
                <Fact label={t('detail.adjust')}>{fee.adjustInstallments ? t('detail.yes') : t('detail.no')}</Fact>
              </dl>
              {fee.notes && <p className="text-sm text-[var(--color-muted)]">{fee.notes}</p>}
              {fee.cancelReason && (
                <p className="text-sm text-[var(--color-danger)]">{t('detail.cancelReason', { reason: fee.cancelReason })}</p>
              )}

              <Section title={t('detail.installments')}>
                <DataTable
                  items={fee.installmentRows}
                  columns={columns}
                  keyExtractor={(row) => row.id}
                  empty={{ title: t('detail.noInstallments') }}
                />
              </Section>

              <Section title={t('detail.shares')}>
                {fee.shares.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('detail.noShares')}</p>}
                <ul className="space-y-1">
                  {fee.shares.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {s.counterparty} · {s.pct} % · <MoneyText value={s.amount} currency={s.currency} />
                      </span>
                      {editable && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void act(`/fees/${feeId}/shares/${s.id}`, { method: 'DELETE' }, t('detail.shareRemoved'))}
                        >
                          {t('detail.remove')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {editable && (
                  <div className="flex flex-wrap items-end gap-2">
                    <CounterpartyInput value={share.counterparty} onChange={(counterparty) => setShare((v) => ({ ...v, counterparty }))} />
                    <PctInput label={t('create.sharePct')} value={share.pct} onChange={(pct) => setShare((v) => ({ ...v, pct }))} />
                    <Button type="button" size="sm" variant="secondary" disabled={busy || !share.counterparty || !share.pct} onClick={() => void addShare()}>
                      {t('detail.addShare')}
                    </Button>
                  </div>
                )}
              </Section>

              <Section title={t('detail.staff')}>
                {fee.staffCommissions.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('detail.noStaff')}</p>}
                <ul className="space-y-1">
                  {fee.staffCommissions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {c.beneficiaryName} · {c.pct} % · <MoneyText value={c.amount} currency={c.currency} /> ·{' '}
                        {c.paidAt ? t('commissions.paid') : t('commissions.pending')}
                      </span>
                      {editable && !c.paidAt && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void act(`/fees/${feeId}/staff-commissions/${c.id}`, { method: 'DELETE' }, t('detail.staffRemoved'))}
                        >
                          {t('detail.remove')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {editable && (
                  <div className="flex flex-wrap items-end gap-2">
                    <StaffSelect users={users} value={staff.userId} onChange={(userId) => setStaff((v) => ({ ...v, userId }))} />
                    <PctInput label={t('create.staffPct')} value={staff.pct} onChange={(pct) => setStaff((v) => ({ ...v, pct }))} />
                    <Button type="button" size="sm" variant="secondary" disabled={busy || !staff.userId || !staff.pct} onClick={() => void addStaff()}>
                      {t('detail.addStaff')}
                    </Button>
                  </div>
                )}
              </Section>

              {canManage && canCancelFee(fee) && (
                <Section title={t('detail.cancelSection')}>
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      aria-label={t('detail.reason')}
                      placeholder={t('detail.reason')}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-72"
                    />
                    <Button type="button" size="sm" variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => void cancelFee()}>
                      {t('detail.cancel')}
                    </Button>
                  </div>
                </Section>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </DialogFooter>
      </Dialog>
        {paying && (
          <FeePayDialog
            target={paying}
            onClose={() => setPaying(null)}
            onDone={() => {
              setVersion((v) => v + 1);
              onChanged();
            }}
          />
        )}
    </>
  );
}
