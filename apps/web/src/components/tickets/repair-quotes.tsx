'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TicketStatus } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import {
  APPROVAL_CHANNELS,
  approveFormSchema,
  canQuote,
  personName,
  quoteFormSchema,
  type RepairPerson,
  type RepairTicket,
  type TicketQuoteRow,
} from '@/lib/ticket-repairs';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const QUOTE_TONE: Record<string, BadgeVariant> = { Pendiente: 'warning', Aprobado: 'success', Rechazado: 'neutral' };

interface Props {
  ticket: RepairTicket;
  providers: RepairPerson[];
  people: RepairPerson[];
  canManage: boolean;
  onChanged: () => void;
}

/** Presupuestos de los proveedores: se cargan, se descartan y el locador aprueba uno (quién y por qué canal). */
export function RepairQuotes({ ticket, providers, people, canManage, onChanged }: Props) {
  const t = useTranslations('tickets.repair');
  const confirm = useConfirm();
  const translate = useSchemaMessages();
  const [approving, setApproving] = useState<TicketQuoteRow | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);

  const quoting = ticket.status === TicketStatus.Presupuestado;
  const addable = canManage && canQuote(ticket.status);

  const form = useZodForm({
    schema: quoteFormSchema,
    initialValues: { providerId: '', amount: '', currency: 'ARS', notes: '' },
    translate,
  });
  const add = form.submit(async (body) => {
    await apiClient(`/tickets/${ticket.id}/quotes`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('quotes.added'));
    form.setValues({ providerId: '', amount: '', notes: '' });
    onChanged();
  });

  async function discard(quote: TicketQuoteRow, action: 'reject' | 'remove') {
    setRowError(null);
    const ok = await confirm({
      title: t(`quotes.${action}.title`),
      body: t(`quotes.${action}.body`, { provider: personName(quote.provider) }),
      confirmLabel: t(`quotes.${action}.confirm`),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      if (action === 'reject') await apiClient(`/tickets/${ticket.id}/quotes/${quote.id}/reject`, { method: 'POST' });
      else await apiClient(`/tickets/${ticket.id}/quotes/${quote.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setRowError(err);
    }
  }

  const columns: DataTableColumn<TicketQuoteRow>[] = [
    { key: 'provider', header: t('quotes.columns.provider'), render: (q) => personName(q.provider) || '—' },
    {
      key: 'amount',
      header: t('quotes.columns.amount'),
      alignRight: true,
      render: (q) => <MoneyText value={q.amount} currency={q.currency} className="font-semibold" />,
    },
    {
      key: 'status',
      header: t('quotes.columns.status'),
      render: (q) => <Badge variant={QUOTE_TONE[q.status] ?? 'neutral'}>{t(`quotes.statuses.${q.status}`)}</Badge>,
    },
    {
      key: 'approval',
      header: t('quotes.columns.approval'),
      render: (q) =>
        q.status === 'Aprobado' && q.approvedAt ? (
          <span className="text-sm">
            {t('quotes.approvedBy', {
              name: personName(q.approvedBy) || '—',
              channel: q.channel ? t(`channels.${q.channel}`) : '—',
              date: formatDateTime(q.approvedAt, { day: '2-digit', month: '2-digit', year: 'numeric' }),
            })}
          </span>
        ) : (
          (q.notes ?? '—')
        ),
    },
    ...(canManage && quoting
      ? [
          {
            key: 'actions',
            header: t('quotes.columns.actions'),
            render: (q: TicketQuoteRow) =>
              q.status === 'Pendiente' ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => setApproving(q)}>
                    {t('quotes.approve.open')}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void discard(q, 'reject')}>
                    {t('quotes.reject.open')}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void discard(q, 'remove')}>
                    {t('quotes.remove.open')}
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="repair-quotes-title" className="card-lux space-y-4 p-6">
      <div>
        <p className="eyebrow">{t('quotes.eyebrow')}</p>
        <h2 id="repair-quotes-title" className="h3">
          {t('quotes.title')}
        </h2>
      </div>

      {rowError != null && <ErrorNotice error={rowError} fallback={t('quotes.error')} />}
      <DataTable
        items={ticket.quotes}
        columns={columns}
        keyExtractor={(q) => q.id}
        empty={{ title: t('quotes.empty.title'), subtitle: t('quotes.empty.subtitle'), iconName: 'invoices' }}
      />

      {addable && (
        <form onSubmit={add} noValidate className="space-y-3 border-t border-[var(--color-border)] pt-4" aria-label={t('quotes.add.title')}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('quotes.add.title')}</h3>
          {form.formError != null && <ErrorNotice error={form.formError} fallback={t('quotes.add.error')} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('quotes.columns.provider')} error={form.errors.providerId} required>
              {(c) => (
                <Select {...c} value={form.values.providerId} onChange={(e) => form.set('providerId', e.target.value)}>
                  <option value="">{t('quotes.add.providerPlaceholder')}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('quotes.columns.amount')} error={form.errors.amount} required>
              {(c) => <Input {...c} inputMode="decimal" value={form.values.amount} onChange={(e) => form.set('amount', e.target.value)} />}
            </FormField>
            <FormField label={t('note')} error={form.errors.notes}>
              {(c) => <Input {...c} value={form.values.notes} onChange={(e) => form.set('notes', e.target.value)} />}
            </FormField>
          </div>
          <Button type="submit" variant="secondary" disabled={form.submitting}>
            {form.submitting ? t('saving') : t('quotes.add.submit')}
          </Button>
        </form>
      )}

      {approving && (
        <ApproveQuoteDialog
          ticketId={ticket.id}
          quote={approving}
          people={people}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

interface ApproveProps {
  ticketId: string;
  quote: TicketQuoteRow;
  people: RepairPerson[];
  onClose: () => void;
  onDone: () => void;
}

/** Aprobar un presupuesto: queda registrado quién lo aprobó (el locador o su representante) y por qué canal. */
function ApproveQuoteDialog({ ticketId, quote, people, onClose, onDone }: ApproveProps) {
  const t = useTranslations('tickets.repair');
  const tCommon = useTranslations('common');
  const translate = useSchemaMessages();
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: approveFormSchema,
    initialValues: { approvedByPersonId: '', channel: '', note: '' },
    translate,
  });

  const save = submit(async (body) => {
    await apiClient(`/tickets/${ticketId}/quotes/${quote.id}/approve`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('quotes.approve.done'));
    onDone();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('quotes.approve.title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-[var(--color-muted)]">
            {t('quotes.approve.body', { provider: personName(quote.provider) })}{' '}
            <MoneyText value={quote.amount} currency={quote.currency} className="font-semibold text-[var(--color-text)]" />
          </p>
          {formError != null && <ErrorNotice error={formError} fallback={t('quotes.approve.error')} />}
          <FormField label={t('approver')} hint={t('approverHint')} error={errors.approvedByPersonId} required>
            {(c) => (
              <Select {...c} value={values.approvedByPersonId} onChange={(e) => set('approvedByPersonId', e.target.value)}>
                <option value="">{t('approverPlaceholder')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personName(p)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('channel')} error={errors.channel} required>
            {(c) => (
              <Select {...c} value={values.channel} onChange={(e) => set('channel', e.target.value)}>
                <option value="">{t('channelPlaceholder')}</option>
                {APPROVAL_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {t(`channels.${ch}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('note')} error={errors.note}>
            {(c) => <Textarea {...c} rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : t('quotes.approve.confirm')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
