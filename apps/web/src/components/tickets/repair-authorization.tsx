'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import {
  APPROVAL_CHANNELS,
  awaitsAuthorization,
  canEstimate,
  estimateFormSchema,
  personName,
  preauthorizeFormSchema,
  type RepairPerson,
  type RepairTicket,
} from '@/lib/ticket-repairs';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  ticket: RepairTicket;
  people: RepairPerson[];
  canManage: boolean;
  onChanged: () => void;
}

/** Estimado de costo y preautorización del locador: decide si se actúa o se consulta antes de presupuestar. */
export function RepairAuthorization({ ticket, people, canManage, onChanged }: Props) {
  const t = useTranslations('tickets.repair');
  const translate = useSchemaMessages();

  const estimate = useZodForm({
    schema: estimateFormSchema,
    initialValues: { amount: ticket.estimatedAmount ?? '', currency: 'ARS' },
    translate,
  });
  const preauth = useZodForm({
    schema: preauthorizeFormSchema,
    initialValues: { amount: '', approvedByPersonId: '', channel: '', note: '' },
    translate,
  });

  const saveEstimate = estimate.submit(async (body) => {
    const res = await apiClient<{ requiresAuthorization: boolean }>(`/tickets/${ticket.id}/estimate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.requiresAuthorization) toast.info(t('estimate.requires'));
    else toast.success(t('estimate.within'));
    onChanged();
  });

  const savePreauth = preauth.submit(async (body) => {
    await apiClient(`/tickets/${ticket.id}/preauthorize`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('preauth.done'));
    onChanged();
  });

  const preauthorized = ticket.preauthorizedAt && ticket.preauthorizedAmount;

  return (
    <section aria-labelledby="repair-auth-title" className="card-lux space-y-4 p-6">
      <div>
        <p className="eyebrow">{t('authorization.eyebrow')}</p>
        <h2 id="repair-auth-title" className="h3">
          {t('authorization.title')}
        </h2>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="micro text-[var(--color-muted)]">{t('estimate.current')}</dt>
          <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">
            {ticket.estimatedAmount ? <MoneyText value={ticket.estimatedAmount} currency={ticket.costCurrency} /> : '—'}
          </dd>
        </div>
        <div>
          <dt className="micro text-[var(--color-muted)]">{t('preauth.current')}</dt>
          <dd className="mt-0.5 text-sm font-medium text-[var(--color-text)]">
            {preauthorized ? (
              <>
                <MoneyText value={ticket.preauthorizedAmount} currency={ticket.costCurrency} />
                <span className="block text-xs font-normal text-[var(--color-muted)]">
                  {t('preauth.by', {
                    name: personName(ticket.preauthorizedBy) || '—',
                    channel: ticket.preauthorizedChannel ? t(`channels.${ticket.preauthorizedChannel}`) : '—',
                    date: formatDateTime(ticket.preauthorizedAt, { day: '2-digit', month: '2-digit', year: 'numeric' }),
                  })}
                </span>
              </>
            ) : (
              t('preauth.none')
            )}
          </dd>
        </div>
      </dl>

      {awaitsAuthorization(ticket.status) && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('authorization.waiting')}
        </p>
      )}

      {canManage && canEstimate(ticket.status) && (
        <form onSubmit={saveEstimate} noValidate className="space-y-3 border-t border-[var(--color-border)] pt-4" aria-label={t('estimate.title')}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('estimate.title')}</h3>
          {estimate.formError != null && <ErrorNotice error={estimate.formError} fallback={t('estimate.error')} />}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField label={t('estimate.amount')} hint={t('estimate.hint')} error={estimate.errors.amount} className="flex-1">
              {(c) => (
                <Input {...c} inputMode="decimal" value={estimate.values.amount} onChange={(e) => estimate.set('amount', e.target.value)} />
              )}
            </FormField>
            <Button type="submit" variant="secondary" disabled={estimate.submitting}>
              {estimate.submitting ? t('saving') : t('estimate.submit')}
            </Button>
          </div>
        </form>
      )}

      {canManage && awaitsAuthorization(ticket.status) && (
        <form onSubmit={savePreauth} noValidate className="space-y-3 border-t border-[var(--color-border)] pt-4" aria-label={t('preauth.title')}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('preauth.title')}</h3>
          {preauth.formError != null && <ErrorNotice error={preauth.formError} fallback={t('preauth.error')} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('preauth.amount')} hint={t('preauth.amountHint')} error={preauth.errors.amount} required>
              {(c) => (
                <Input {...c} inputMode="decimal" value={preauth.values.amount} onChange={(e) => preauth.set('amount', e.target.value)} />
              )}
            </FormField>
            <FormField label={t('approver')} error={preauth.errors.approvedByPersonId} required>
              {(c) => (
                <Select {...c} value={preauth.values.approvedByPersonId} onChange={(e) => preauth.set('approvedByPersonId', e.target.value)}>
                  <option value="">{t('approverPlaceholder')}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('channel')} error={preauth.errors.channel} required>
              {(c) => (
                <Select {...c} value={preauth.values.channel} onChange={(e) => preauth.set('channel', e.target.value)}>
                  <option value="">{t('channelPlaceholder')}</option>
                  {APPROVAL_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {t(`channels.${ch}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <FormField label={t('note')} error={preauth.errors.note}>
            {(c) => <Textarea {...c} rows={2} value={preauth.values.note} onChange={(e) => preauth.set('note', e.target.value)} />}
          </FormField>
          <Button type="submit" disabled={preauth.submitting}>
            {preauth.submitting ? t('saving') : t('preauth.submit')}
          </Button>
        </form>
      )}
    </section>
  );
}
