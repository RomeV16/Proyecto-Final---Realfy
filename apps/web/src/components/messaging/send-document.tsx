'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageChannel, type OutboxItem, type OutboxPage, type SendableDocument } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { documentOutboxHref, documentOutboxPath } from '@/lib/messaging';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { OutboxTable } from './outbox-table';
import { useApiData } from './use-api-data';
import { useMessageText } from './use-message-text';

interface Props {
  kind: SendableDocument;
  /** Id del recibo o del estado de cuenta. */
  id: string;
  size?: 'sm' | 'md';
}

/**
 * Botón "Enviar" de un recibo o un estado de cuenta: abre un diálogo para mandarlo por mail o por WhatsApp, muestra
 * cómo quedó el mensaje (en cola, frenado y por qué) y los mensajes que ya tiene el documento. Solo lo ven los
 * roles que pueden mandar; la API decide el destinatario y no duplica un envío por el mismo canal.
 */
export function SendDocument({ kind, id, size = 'sm' }: Props) {
  const t = useTranslations('messaging.send');
  const canSend = useCan('messaging.send');
  const [open, setOpen] = useState(false);
  if (!canSend) return null;
  return (
    <>
      <Button type="button" size={size} variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="mail" className="h-4 w-4" strokeWidth={1.9} />
        {t('open')}
      </Button>
      {open && <SendDocumentDialog kind={kind} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendDocumentDialog({ kind, id, onClose }: { kind: SendableDocument; id: string; onClose: () => void }) {
  const t = useTranslations('messaging.send');
  const tCommon = useTranslations('common');
  const text = useMessageText();
  const history = useApiData<OutboxPage>(documentOutboxPath(kind, id));
  const [sending, setSending] = useState<MessageChannel | null>(null);
  const [last, setLast] = useState<OutboxItem | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function send(channel: MessageChannel) {
    setSending(channel);
    setError(null);
    try {
      const item = await apiClient<OutboxItem>('/outbox/send', {
        method: 'POST',
        body: JSON.stringify({ kind, id, channel }),
      });
      setLast(item);
      toast.success(t('queued'));
      history.reload();
    } catch (err) {
      setError(err);
    } finally {
      setSending(null);
    }
  }

  const explanation = last ? text.explain(last) : null;

  return (
    <Dialog open onClose={onClose} busy={sending !== null} size="lg">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t(`title.${kind}`)}</h2>
      </DialogHeader>
      <DialogBody className="space-y-5">
        <p className="text-sm text-[var(--color-muted)]">{t('explain')}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void send(MessageChannel.Email)} disabled={sending !== null}>
            <Icon name="mail" className="h-4 w-4" strokeWidth={1.9} />
            {t('email')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void send(MessageChannel.WhatsApp)} disabled={sending !== null}>
            <Icon name="phone" className="h-4 w-4" strokeWidth={1.9} />
            {t('whatsapp')}
          </Button>
        </div>
        {error != null && <ErrorNotice error={error} fallback={t('error')} />}
        {last && (
          <section aria-label={t('last')} className="space-y-1 rounded-lg border border-[var(--color-border)] p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text)]">
              <span className="font-medium">{t('last')}:</span>
              <span>
                {text.channel(last.channel)} · {last.to}
              </span>
              <StatusBadge domain="mensaje" status={last.status} />
            </p>
            {explanation && <p className="text-sm text-[var(--color-muted)]">{explanation}</p>}
          </section>
        )}
        <section aria-labelledby="send-document-history" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="send-document-history" className="text-sm font-semibold text-[var(--color-text)]">
              {t('history')}
            </h3>
            <Link href={documentOutboxHref(kind, id)} className="text-sm text-[var(--color-brand-600)] hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          {history.error != null ? (
            <ErrorNotice error={history.error} fallback={t('loadError')} />
          ) : (
            <OutboxTable
              items={history.data?.items ?? []}
              loading={history.data === null}
              onChanged={history.reload}
              compact
              emptyTitle={t('none')}
            />
          )}
        </section>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={sending !== null}>
          {tCommon('close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
