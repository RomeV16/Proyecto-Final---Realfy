'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { OwnerStatementStatus } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { Link } from '@/i18n/navigation';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { formatDate, formatMoney, formatPeriod } from '@/lib/format';
import { absAmount, balanceReading, periodOf, suggestedPayout, type StatementDetail, type StatementLine } from '@/lib/owner-accounts';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { useErrorText } from '@/components/cash/use-cash-data';
import { BalanceAmount, SignedAmount } from './balance-amount';
import { PayoutDialog } from './payout-dialog';

/**
 * Un estado de cuenta: saldo anterior, créditos, descuentos y pagos del mes con
 * el saldo al cierre, y los movimientos de cada unidad. Desde acá se descarga el
 * PDF, se emite, se anula y se registra el pago al locador.
 */
export function OwnerStatementDetail({ statementId }: { statementId: string }) {
  const t = useTranslations('ownerAccounts');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const canView = useCan('ownerAccounts.view');
  const canManage = useCan('ownerAccounts.manage');
  const canAdminister = useCan('ownerAccounts.administer');
  const [data, setData] = useState<StatementDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'annul' | 'payout' | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiClient<StatementDetail>(`/owner-statements/${statementId}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [statementId]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load, version]);

  if (!canView) {
    return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;
  }
  if (error != null && !data) return <ErrorNotice error={error} fallback={t('detail.loadError')} />;
  if (!data) return <Skeleton className="h-64 w-full" />;

  const reload = () => setVersion((v) => v + 1);
  const cur = data.currency;
  const period = periodOf(data.period);

  async function issue() {
    if (!(await confirm({ title: t('detail.issueTitle'), body: t('detail.issueConfirm'), confirmLabel: t('detail.issue') }))) return;
    setBusy(true);
    try {
      await apiClient(`/owner-statements/${statementId}/issue`, { method: 'POST' });
      toast.success(t('detail.issued'));
      reload();
    } catch (err) {
      toast.error(errorText(err, t('detail.issueError')));
    } finally {
      setBusy(false);
    }
  }

  function pdf() {
    downloadFile(`/owner-statements/${statementId}/pdf`, `estado-de-cuenta-${period}-${cur}.pdf`).catch(() => {
      toast.error(tCommon('downloadFailed'));
    });
  }

  const columns: DataTableColumn<StatementLine>[] = [
    { key: 'date', header: t('ledger.columns.date'), render: (e) => <DateText value={e.date} className="whitespace-nowrap" /> },
    { key: 'type', header: t('ledger.columns.type'), render: (e) => t(`types.${e.type}`) },
    {
      key: 'description',
      header: t('ledger.columns.description'),
      render: (e) => (
        <span>
          {e.description}
          {e.provisional && <span className="ml-2 text-xs italic text-[var(--color-warning)]">{t('detail.provisional')}</span>}
        </span>
      ),
    },
    { key: 'amount', header: t('ledger.columns.amount'), alignRight: true, render: (e) => <SignedAmount value={e.amount} currency={cur} /> },
  ];

  const row = (label: string, value: string, negative = false) => (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-sm text-[var(--color-muted)]">{label}</dt>
      <dd>
        <MoneyText value={negative && Number(value) !== 0 ? `-${value}` : value} currency={cur} decimals={2} className="tabular-nums" />
      </dd>
    </div>
  );
  const previous = (Number(data.totals.opening) - Number(data.totals.initial)).toFixed(2);
  const custody = Number(data.custody);

  return (
    <div className="space-y-6">
      <Link href="/estados-de-cuenta" className="text-sm text-[var(--color-brand-600)] hover:underline">
        ← {t('detail.back')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <StatusBadge domain="estadoCuenta" status={data.status} size="md" />
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            {t('detail.title', { name: data.person.name, period: formatPeriod(data.period) })}
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            {t('detail.range', { from: formatDate(data.from), to: formatDate(data.to), currency: cur })}
          </p>
          <Link href={`/locadores/${data.personId}?currency=${cur}`} className="text-sm text-[var(--color-brand-600)] hover:underline">
            {t('detail.ledgerLink')}
          </Link>
          {data.status === OwnerStatementStatus.Anulado && data.annulReason && (
            <p className="text-sm text-[var(--color-danger)]">{t('detail.annulledBecause', { reason: data.annulReason })}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={pdf}>
            {t('detail.pdf')}
          </Button>
          {canManage && data.status === OwnerStatementStatus.Borrador && (
            <Button type="button" onClick={() => void issue()} disabled={busy}>
              {t('detail.issue')}
            </Button>
          )}
          {canManage && (
            <Button type="button" variant="secondary" onClick={() => setDialog('payout')}>
              {t('ledger.payout')}
            </Button>
          )}
          {canAdminister && data.status !== OwnerStatementStatus.Anulado && (
            <Button type="button" variant="danger" onClick={() => setDialog('annul')} disabled={busy}>
              {t('detail.annul')}
            </Button>
          )}
        </div>
      </header>

      <section aria-labelledby="statement-totals" className="max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 id="statement-totals" className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          {t('detail.totals')}
        </h2>
        <dl className="divide-y divide-[var(--color-border)]">
          {row(t('detail.previous'), previous)}
          {Number(data.totals.initial) !== 0 && row(t('detail.initial'), data.totals.initial)}
          {row(t('detail.credits'), data.totals.credits)}
          {row(t('detail.debits'), data.totals.debits, true)}
          {row(t('detail.payouts'), data.totals.payouts, true)}
          <div className="flex items-center justify-between pt-3">
            <dt className="text-sm font-semibold text-[var(--color-text)]">{t('detail.closing')}</dt>
            <dd>
              <BalanceAmount value={data.totals.closing} currency={cur} />
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-[var(--color-text)]">
          {t(`detail.reading.${balanceReading(data.totals.closing)}`, {
            amount: formatMoney(absAmount(data.totals.closing), cur, { decimals: 2 }),
          })}
        </p>
        {custody > 0 && (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {t('detail.custody')} <MoneyText value={data.custody} currency={cur} decimals={2} className="font-medium" />
          </p>
        )}
      </section>

      {data.groups.length === 0 && <p className="text-sm italic text-[var(--color-muted)]">{t('detail.noMovements')}</p>}
      {data.groups.map((g) => (
        <section
          key={g.propertyId ?? 'general'}
          aria-label={g.label ?? t('detail.general')}
          className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{g.label ?? t('detail.general')}</h2>
            <p className="text-sm text-[var(--color-muted)]">
              {t('detail.subtotal')} <SignedAmount value={g.net} currency={cur} />
            </p>
          </div>
          <DataTable items={g.entries} columns={columns} keyExtractor={(e) => e.id} empty={{ title: t('detail.noMovements') }} />
        </section>
      ))}

      {dialog === 'annul' && <AnnulDialog statementId={statementId} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog === 'payout' && (
        <PayoutDialog
          personId={data.personId}
          personName={data.person.name}
          currency={cur}
          suggested={suggestedPayout(data.totals.closing, data.custody)}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

/** Anular un estado: libera sus movimientos para el próximo; pide el motivo. */
function AnnulDialog({ statementId, onClose, onDone }: { statementId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('ownerAccounts.detail');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setMissing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient(`/owner-statements/${statementId}/annul`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      toast.success(t('annulled'));
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={saving} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('annulTitle')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error != null && <ErrorNotice error={error} fallback={t('annulError')} />}
          <p className="text-sm text-[var(--color-muted)]">{t('annulExplain')}</p>
          <FormField label={t('annulReason')} error={missing ? t('annulReasonRequired') : undefined} required>
            {(c) => (
              <Textarea
                {...c}
                rows={3}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setMissing(false);
                }}
              />
            )}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={saving}>
            {t('annulConfirm')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
