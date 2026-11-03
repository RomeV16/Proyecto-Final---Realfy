'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConsentStatus, type ChannelConsent, type PersonConsents as PersonConsentsData } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { useApiData } from '@/components/messaging/use-api-data';
import { useMessageText } from '@/components/messaging/use-message-text';

interface Pending {
  channel: ChannelConsent['channel'];
  status: ConsentStatus;
}

/**
 * Consentimiento de mensajes de una persona, canal por canal: si dio el alta o pidió la baja, quién lo registró,
 * cuándo, con qué nota y a qué dirección se aplica, con el historial. Quien gestiona registra un alta o una baja.
 */
export function PersonConsents({ personId }: { personId: string }) {
  const t = useTranslations('messaging.consents');
  const canView = useCan('consents.view');
  const canManage = useCan('consents.manage');
  const canSeeMessages = useCan('messaging.view');
  const consents = useApiData<PersonConsentsData>(canView ? `/persons/${personId}/consents` : null);
  const [pending, setPending] = useState<Pending | null>(null);

  if (!canView) return null;
  const channels = consents.data?.channels ?? [];

  return (
    <section
      aria-labelledby="person-consents-title"
      className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] pb-2">
        <h3 id="person-consents-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('title')}
        </h3>
        {canSeeMessages && (
          <Link
            href={`/mensajeria?personId=${encodeURIComponent(personId)}`}
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            {t('viewMessages')}
          </Link>
        )}
      </div>
      <p className="text-sm text-[var(--color-muted)]">{t('hint')}</p>

      {consents.error != null && <ErrorNotice error={consents.error} fallback={t('loadError')} />}
      {consents.error == null && consents.data === null && <Skeleton className="h-24 w-full" />}
      <ul className="divide-y divide-[var(--color-border)]">
        {channels.map((c) => (
          <ChannelRow key={c.channel} consent={c} canManage={canManage} onRecord={(status) => setPending({ channel: c.channel, status })} />
        ))}
      </ul>

      {pending && (
        <ConsentDialog
          personId={personId}
          pending={pending}
          onClose={() => setPending(null)}
          onSaved={(data) => consents.setData(data)}
        />
      )}
    </section>
  );
}

function ChannelRow({
  consent,
  canManage,
  onRecord,
}: {
  consent: ChannelConsent;
  canManage: boolean;
  onRecord: (status: ConsentStatus) => void;
}) {
  const t = useTranslations('messaging.consents');
  const text = useMessageText();
  const label = (status: ConsentStatus | null) =>
    status ? <StatusBadge domain="consentimiento" status={status} /> : <Badge dot>{t('none')}</Badge>;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            {text.channel(consent.channel)}
            {label(consent.status)}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {consent.address ? t('address', { address: consent.address }) : t('noAddress')}
          </p>
          {consent.status && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
              {consent.source && (
                <>
                  <dt className="text-[var(--color-muted)]">{t('source')}</dt>
                  <dd className="text-[var(--color-text)]">{t(`sources.${consent.source}`)}</dd>
                </>
              )}
              {consent.at && (
                <>
                  <dt className="text-[var(--color-muted)]">{t('date')}</dt>
                  <dd className="text-[var(--color-text)]">
                    <DateText value={consent.at} kind="datetime" />
                  </dd>
                </>
              )}
              {consent.note && (
                <>
                  <dt className="text-[var(--color-muted)]">{t('note')}</dt>
                  <dd className="whitespace-pre-wrap text-[var(--color-text)]">{consent.note}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => onRecord(ConsentStatus.OptIn)}>
              {t('optIn')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onRecord(ConsentStatus.OptOut)}>
              {t('optOut')}
            </Button>
          </div>
        )}
      </div>
      {consent.history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--color-brand-600)]">{t('history', { count: consent.history.length })}</summary>
          <ol className="mt-2 space-y-2 border-l border-[var(--color-border)] pl-3">
            {consent.history.map((h) => (
              <li key={`${h.at}-${h.status}-${h.source}`} className="space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-[var(--color-text)]">
                  <StatusBadge domain="consentimiento" status={h.status} />
                  <DateText value={h.at} kind="datetime" />
                  <span className="text-[var(--color-muted)]">· {t(`sources.${h.source}`)}</span>
                </p>
                {h.address && <p className="text-[var(--color-muted)]">{t('address', { address: h.address })}</p>}
                {h.note && <p className="whitespace-pre-wrap text-[var(--color-text)]">{h.note}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function ConsentDialog({
  personId,
  pending,
  onClose,
  onSaved,
}: {
  personId: string;
  pending: Pending;
  onClose: () => void;
  onSaved: (data: PersonConsentsData) => void;
}) {
  const t = useTranslations('messaging.consents.dialog');
  const tCommon = useTranslations('common');
  const text = useMessageText();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { channel: pending.channel, status: pending.status, ...(note.trim() ? { note: note.trim() } : {}) };
      const data = await apiClient<PersonConsentsData>(`/persons/${personId}/consents`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      onSaved(data);
      toast.success(t('saved'));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const optIn = pending.status === ConsentStatus.OptIn;
  return (
    <Dialog open onClose={onClose} busy={saving} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {t(optIn ? 'titleOptIn' : 'titleOptOut', { channel: text.channel(pending.channel) })}
          </h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error != null && <ErrorNotice error={error} fallback={t('error')} />}
          <p className="text-sm text-[var(--color-muted)]">{t(optIn ? 'explainOptIn' : 'explainOptOut')}</p>
          <FormField label={t('note')} hint={t('noteHint')}>
            {(c) => <Textarea {...c} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" variant={optIn ? 'primary' : 'danger'} disabled={saving}>
            {t('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
