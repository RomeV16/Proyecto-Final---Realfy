'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CollectionActionStatus, type CollectionActionItem, type CollectionCaseDetail, type LetterFields } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { canDerive, canJudicialize, isLetterPending, isOpen, isReminder, letterPdfPath, overdueTone } from '@/lib/collections';
import { downloadFile } from '@/lib/download';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { today } from '@/lib/cash';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiData } from '@/components/messaging/use-api-data';
import { useErrorText } from '@/components/cash/use-cash-data';
import { CaseActionDialog, type ActionField } from './case-action-dialog';
import { NextActionText } from './case-table';

type DialogKind = 'note' | 'agreement' | 'derive' | 'judicial' | 'close' | 'letterSent' | 'letterEdit';
type DebtLine = CollectionCaseDetail['debt'][number];

/** Un renglón de la línea de tiempo: qué se hizo, cuándo, con qué importe y, si fue un aviso, cómo salió. */
function TimelineItem({ action, children }: { action: CollectionActionItem; children?: ReactNode }) {
  const t = useTranslations('collections');
  return (
    <li className="space-y-1 border-l-2 border-[var(--color-border)] pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--color-text)]">
          {t(`actionKinds.${action.kind}`)}
          {action.level ? ` · ${t('level', { n: action.level })}` : ''}
        </span>
        {action.status === CollectionActionStatus.Preparada && <Badge variant="warning">{t('statuses.Preparada')}</Badge>}
        {action.messageStatus && <StatusBadge domain="mensaje" status={action.messageStatus} />}
        {action.channel && <span className="text-xs text-[var(--color-muted)]">{t(`channels.${action.channel}`)}</span>}
        <DateText value={action.at} kind="datetime" className="text-xs text-[var(--color-muted)]" />
      </div>
      {action.amount && (
        <p className="text-sm text-[var(--color-muted)]">
          {t('timeline.amount')}: <MoneyText value={action.amount} decimals={2} />
        </p>
      )}
      {action.onDate && (
        <p className="text-sm text-[var(--color-muted)]">
          {t('timeline.onDate')}: <DateText value={action.onDate} />
        </p>
      )}
      {isReminder(action.kind) && !action.channel && <p className="text-sm text-[var(--color-muted)]">{t('timeline.noChannel')}</p>}
      {action.note && <p className="text-sm text-[var(--color-text)]">{action.note}</p>}
      {action.createdByName && <p className="text-xs text-[var(--color-muted)]">{t('timeline.by', { name: action.createdByName })}</p>}
      {children}
    </li>
  );
}

/**
 * Detalle de un caso de cobranza: lo que se debe hoy por liquidación (saldo y punitorios), lo que toca después, la
 * línea de tiempo con cada aviso y su estado, el borrador de la carta documento y las acciones manuales. Nada
 * legal sale solo: la carta se revisa, se manda en papel y recién entonces se confirma; derivar es una decisión.
 */
export function CaseDetail({ id }: { id: string }) {
  const t = useTranslations('collections');
  const errorText = useErrorText();
  const { user } = useAuth();
  const canView = useCan('collections.view');
  const canManage = useCan('collections.manage');
  const canEscalate = useCan('collections.escalate');
  const { data, error, setData } = useApiData<CollectionCaseDetail>(canView ? `/collection-cases/${id}` : null);
  const [dialog, setDialog] = useState<{ kind: DialogKind; action?: CollectionActionItem } | null>(null);

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }
  if (error) return <ErrorNotice error={error} fallback={t('detail.loadError')} />;
  if (!data) return <Skeleton className="h-64 w-full" />;

  const open = isOpen(data.stage);
  const letter = data.actions.find((a) => isLetterPending(a));

  /** POST/PATCH que devuelve el caso actualizado. */
  async function send(path: string, method: 'POST' | 'PATCH', body: unknown, done: string) {
    const res = await apiClient<CollectionCaseDetail>(path, { method, body: JSON.stringify(body) });
    setData(res);
    toast.success(done);
  }
  const base = `/collection-cases/${id}`;
  const optional = (v: string) => (v.trim() ? { note: v.trim() } : {});

  async function assignToMe(assigneeId: string | null) {
    try {
      await send(base, 'PATCH', { assigneeId }, t('detail.assigned'));
    } catch (err) {
      toast.error(errorText(err, t('detail.assignError')));
    }
  }

  async function openPdf(action: CollectionActionItem) {
    try {
      await downloadFile(letterPdfPath(id, action.id), `carta-documento-${action.id.slice(0, 8)}.pdf`);
    } catch (err) {
      toast.error(errorText(err, t('letter.pdfError')));
    }
  }

  const note: ActionField = { name: 'note', label: t('fields.note'), kind: 'textarea', maxLength: 2000 };
  const dialogs: Record<DialogKind, () => ReactNode> = {
    note: () => (
      <CaseActionDialog
        title={t('dialogs.note.title')}
        submitLabel={t('dialogs.note.submit')}
        fields={[{ ...note, required: true }]}
        onSubmit={(v) => send(`${base}/notes`, 'POST', { note: v.note.trim() }, t('dialogs.note.done'))}
        onClose={() => setDialog(null)}
      />
    ),
    agreement: () => (
      <CaseActionDialog
        title={t('dialogs.agreement.title')}
        description={t('dialogs.agreement.description')}
        submitLabel={t('dialogs.agreement.submit')}
        fields={[
          { name: 'payOn', label: t('fields.payOn'), kind: 'date', required: true },
          { name: 'amount', label: t('fields.agreedAmount'), kind: 'number', hint: t('fields.agreedAmountHint') },
          note,
        ]}
        initial={{ payOn: today() }}
        onSubmit={(v) =>
          send(
            `${base}/agreement`,
            'POST',
            { payOn: v.payOn, ...(v.amount.trim() ? { amount: v.amount.trim().replace(',', '.') } : {}), ...optional(v.note) },
            t('dialogs.agreement.done'),
          )
        }
        onClose={() => setDialog(null)}
      />
    ),
    derive: () => (
      <CaseActionDialog
        title={t('dialogs.derive.title')}
        description={t('dialogs.derive.description')}
        submitLabel={t('dialogs.derive.submit')}
        fields={[{ name: 'lawyer', label: t('fields.lawyer'), kind: 'text', maxLength: 200 }, note]}
        onSubmit={(v) =>
          send(
            `${base}/derive`,
            'POST',
            { ...(v.lawyer.trim() ? { lawyer: v.lawyer.trim() } : {}), ...optional(v.note) },
            t('dialogs.derive.done'),
          )
        }
        onClose={() => setDialog(null)}
      />
    ),
    judicial: () => (
      <CaseActionDialog
        title={t('dialogs.judicial.title')}
        description={t('dialogs.judicial.description')}
        submitLabel={t('dialogs.judicial.submit')}
        fields={[note]}
        onSubmit={(v) => send(`${base}/judicial`, 'POST', optional(v.note), t('dialogs.judicial.done'))}
        onClose={() => setDialog(null)}
      />
    ),
    close: () => (
      <CaseActionDialog
        title={t('dialogs.close.title')}
        description={t('dialogs.close.description')}
        submitLabel={t('dialogs.close.submit')}
        fields={[{ ...note, label: t('fields.closeReason'), required: true }]}
        onSubmit={(v) => send(`${base}/close`, 'POST', { note: v.note.trim() }, t('dialogs.close.done'))}
        onClose={() => setDialog(null)}
      />
    ),
    letterSent: () => (
      <CaseActionDialog
        title={t('dialogs.letterSent.title')}
        description={t('dialogs.letterSent.description')}
        submitLabel={t('dialogs.letterSent.submit')}
        fields={[
          { name: 'sentOn', label: t('fields.sentOn'), kind: 'date', required: true },
          { ...note, label: t('fields.tracking'), maxLength: 500 },
        ]}
        initial={{ sentOn: today() }}
        onSubmit={(v) =>
          send(
            `${base}/actions/${dialog?.action?.id}/sent`,
            'POST',
            { sentOn: v.sentOn, ...optional(v.note) },
            t('dialogs.letterSent.done'),
          )
        }
        onClose={() => setDialog(null)}
      />
    ),
    letterEdit: () => {
      const fields = dialog?.action?.letter;
      return (
        <CaseActionDialog
          title={t('dialogs.letterEdit.title')}
          description={t('dialogs.letterEdit.description')}
          submitLabel={t('dialogs.letterEdit.submit')}
          fields={[
            { name: 'recipientName', label: t('letter.recipientName'), kind: 'text', required: true, maxLength: 200 },
            { name: 'recipientAddress', label: t('letter.recipientAddress'), kind: 'text', maxLength: 300 },
            { name: 'propertyAddress', label: t('letter.propertyAddress'), kind: 'text', maxLength: 300 },
            { name: 'periods', label: t('letter.periods'), kind: 'text', maxLength: 200 },
            { name: 'amount', label: t('letter.amount'), kind: 'text', maxLength: 60 },
            { name: 'termDays', label: t('letter.termDays'), kind: 'number', required: true },
            { name: 'extraText', label: t('letter.extraText'), kind: 'textarea', maxLength: 2000 },
          ]}
          initial={fields ? letterInitial(fields) : {}}
          onSubmit={(v) =>
            send(
              `${base}/actions/${dialog?.action?.id}`,
              'PATCH',
              {
                recipientName: v.recipientName.trim(),
                recipientAddress: v.recipientAddress.trim(),
                propertyAddress: v.propertyAddress.trim(),
                periods: v.periods.trim(),
                amount: v.amount.trim(),
                termDays: Number(v.termDays),
                extraText: v.extraText.trim(),
              },
              t('dialogs.letterEdit.done'),
            )
          }
          onClose={() => setDialog(null)}
        />
      );
    },
  };

  const columns: DataTableColumn<DebtLine>[] = [
    { key: 'period', header: t('debt.period'), render: (l) => <DateText value={l.period} style="monthYear" /> },
    { key: 'due', header: t('debt.due'), render: (l) => <DateText value={l.dueDate} /> },
    { key: 'days', header: t('debt.days'), alignRight: true, render: (l) => l.daysOverdue },
    { key: 'balance', header: t('debt.balance'), alignRight: true, render: (l) => <MoneyText value={l.balance} currency={data.currency} decimals={2} /> },
    { key: 'penalty', header: t('debt.penalty'), alignRight: true, render: (l) => <MoneyText value={l.penalty} currency={data.currency} decimals={2} /> },
    { key: 'total', header: t('debt.total'), alignRight: true, render: (l) => <MoneyText value={l.total} currency={data.currency} decimals={2} className="font-semibold" /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/cobranza" className="text-sm text-[var(--color-brand-600)] hover:underline">
          {t('detail.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{data.propertyLabel || t('noProperty')}</h1>
          <StatusBadge domain="cobranza" status={data.stage} size="md" />
          <Badge variant={overdueTone(data.daysOverdue)} size="md">
            {t('days', { n: data.daysOverdue })}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {data.tenantNames || t('noTenant')} ·{' '}
          <Link href={`/contracts/${data.contractId}`} className="text-[var(--color-brand-600)] hover:underline">
            {t('detail.contract')}
          </Link>
          {data.assigneeName ? ` · ${t('detail.assignedTo', { name: data.assigneeName })}` : ''}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label={t('detail.summary')}>
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <p className="text-xs text-[var(--color-muted)]">{t('detail.payoffToday')}</p>
          <MoneyText value={data.payoffToday} currency={data.currency} decimals={2} className="text-xl font-semibold" />
          <p className="mt-1 text-xs text-[var(--color-muted)]">{t('detail.payoffHint')}</p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <p className="text-xs text-[var(--color-muted)]">{t('detail.balance')}</p>
          <MoneyText value={data.balance} currency={data.currency} decimals={2} className="text-xl font-semibold" />
        </div>
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <p className="text-xs text-[var(--color-muted)]">{t('detail.next')}</p>
          <p className="text-sm font-medium text-[var(--color-text)]">{open ? <NextActionText item={data} /> : t('detail.closed')}</p>
          {data.nextActionManual && open && <p className="mt-1 text-xs text-[var(--color-muted)]">{t('detail.manualHint')}</p>}
          {data.closeReason && <p className="mt-1 text-xs text-[var(--color-muted)]">{t(`closeReasons.${data.closeReason}`)}</p>}
        </div>
      </section>

      {open && canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'note' })}>
            {t('actions.note')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'agreement' })}>
            {t('actions.agreement')}
          </Button>
          {user?.id && data.assigneeId !== user.id && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void assignToMe(user.id)}>
              {t('actions.assignToMe')}
            </Button>
          )}
          {data.assigneeId && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void assignToMe(null)}>
              {t('actions.unassign')}
            </Button>
          )}
          {canEscalate && canDerive(data.stage) && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'derive' })}>
              {t('actions.derive')}
            </Button>
          )}
          {canEscalate && canJudicialize(data.stage) && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'judicial' })}>
              {t('actions.judicial')}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: 'close' })}>
            {t('actions.close')}
          </Button>
        </div>
      )}

      {letter?.letter && (
        <section className="space-y-3 rounded-xl border border-[var(--color-border)] p-4" aria-label={t('letter.title')}>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('letter.title')}</h2>
          <p className="text-sm text-[var(--color-muted)]">{t('letter.notice')}</p>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-[var(--color-muted)]">{t('letter.recipientName')}</dt><dd>{letter.letter.recipientName || '—'}</dd></div>
            <div><dt className="text-xs text-[var(--color-muted)]">{t('letter.recipientAddress')}</dt><dd>{letter.letter.recipientAddress || '—'}</dd></div>
            <div><dt className="text-xs text-[var(--color-muted)]">{t('letter.periods')}</dt><dd>{letter.letter.periods || '—'}</dd></div>
            <div><dt className="text-xs text-[var(--color-muted)]">{t('letter.amount')}</dt><dd>{letter.letter.amount || '—'}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void openPdf(letter)}>
              {t('letter.pdf')}
            </Button>
            {canManage && open && (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'letterEdit', action: letter })}>
                  {t('letter.edit')}
                </Button>
                <Button type="button" size="sm" onClick={() => setDialog({ kind: 'letterSent', action: letter })}>
                  {t('letter.markSent')}
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-label={t('debt.title')}>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('debt.title')}</h2>
        <DataTable
          items={data.debt}
          columns={columns}
          keyExtractor={(l) => l.liquidacionId}
          loading={false}
          empty={{ title: t('debt.empty'), iconName: 'delinquency' }}
        />
      </section>

      <section className="space-y-3" aria-label={t('timeline.title')}>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('timeline.title')}</h2>
        {data.actions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t('timeline.empty')}</p>
        ) : (
          <ol className="space-y-4">
            {data.actions.map((a) => (
              <TimelineItem key={a.id} action={a} />
            ))}
          </ol>
        )}
      </section>

      {dialog && dialogs[dialog.kind]()}
    </div>
  );
}

/** Campos del borrador de la carta como texto de formulario. */
function letterInitial(l: LetterFields): Record<string, string> {
  return { ...l, termDays: String(l.termDays) };
}
