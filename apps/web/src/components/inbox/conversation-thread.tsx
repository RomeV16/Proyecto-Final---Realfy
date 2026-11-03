'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { QuickReply } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { fillQuickReply, INBOX_STATUSES, type ConversationDetail } from '@/lib/inbox';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { LinkDialog } from './link-dialog';
import { SlaBadge } from './sla-badge';

export interface StaffOption {
  id: string;
  name: string;
}

interface ThreadProps {
  conversation: ConversationDetail;
  slaMinutes: number;
  now: Date;
  quickReplies: QuickReply[];
  /** Usuario de la sesión: puede tomar la consulta sin permiso para asignar a otros. */
  userId: string;
  /** Con permiso para asignar a otra persona (Admin y Gerente) y el personal entre quienes elegir. */
  canAssign: boolean;
  staff: StaffOption[];
  /** Algo cambió en la consulta: la pantalla vuelve a leer la lista y el hilo. */
  onChanged: () => void;
  /** En pantallas angostas el hilo ocupa todo el ancho y se vuelve a la lista con este botón. */
  onBack: () => void;
}

/** El hilo de una consulta: mensajes, responsable, estado, vínculos y el cuadro para responder. */
export function ConversationThread({
  conversation: c,
  slaMinutes,
  now,
  quickReplies,
  userId,
  canAssign,
  staff,
  onChanged,
  onBack,
}: ThreadProps) {
  const t = useTranslations('inbox');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [linking, setLinking] = useState(false);

  async function act(path: string, method: 'PUT' | 'POST', body: object, okText?: string) {
    setError(null);
    try {
      await apiClient(`/conversations/${c.id}/${path}`, { method, body: JSON.stringify(body) });
      if (okText) toast.success(okText);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !c.replyRoute) return;
    setSending(true);
    setError(null);
    try {
      await apiClient(`/conversations/${c.id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
      setText('');
      toast.success(t('thread.sent'));
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  function insertQuickReply(id: string) {
    const reply = quickReplies.find((q) => q.id === id);
    if (reply) setText(fillQuickReply(reply.body, c.counterpartName));
  }

  const title = c.counterpartName || c.address;
  const mine = c.assignee?.id === userId;

  return (
    <section aria-label={t('thread.label')} className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b border-[var(--color-border)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onBack} className="lg:hidden">
            {t('thread.back')}
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--color-text)]">{title}</h2>
          <StatusBadge domain="consulta" status={c.status} />
          <SlaBadge conversation={c} slaMinutes={slaMinutes} now={now} />
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          {t(`channels.${c.channel}`)} · {c.address}
          {c.subject ? ` · ${c.subject}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canAssign ? (
            <Select
              aria-label={t('thread.assignee')}
              value={c.assignee?.id ?? ''}
              onChange={(e) => void act('assignee', 'PUT', { assigneeUserId: e.target.value || null })}
              className="w-auto"
            >
              <option value="">{t('list.unassigned')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <span className="text-[var(--color-muted)]">{c.assignee?.name ?? t('list.unassigned')}</span>
              {!mine && (
                <Button type="button" size="sm" variant="secondary" onClick={() => void act('assignee', 'PUT', { assigneeUserId: userId })}>
                  {t('thread.take')}
                </Button>
              )}
            </>
          )}
          <Select
            aria-label={t('thread.status')}
            value={c.status}
            onChange={(e) => void act('status', 'PUT', { status: e.target.value })}
            className="w-auto"
          >
            {INBOX_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" variant="secondary" onClick={() => setLinking(true)}>
            {t('thread.link')}
          </Button>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
          {c.person && (
            <Link href={`/persons/${c.person.id}`} className="text-[var(--color-brand-600)] hover:underline">
              {t('thread.person', { name: `${c.person.firstName} ${c.person.lastName}`.trim() })}
            </Link>
          )}
          {c.lead && (
            <Link href="/leads" className="text-[var(--color-brand-600)] hover:underline">
              {t('thread.lead')}
            </Link>
          )}
          {c.related?.type === 'Property' && (
            <Link href={`/properties/${c.related.id}`} className="text-[var(--color-brand-600)] hover:underline">
              {t('thread.property')}
            </Link>
          )}
          {c.related?.type === 'Contract' && (
            <Link href={`/contracts/${c.related.id}`} className="text-[var(--color-brand-600)] hover:underline">
              {t('thread.contract')}
            </Link>
          )}
          {!c.person && !c.lead && !c.related && <span>{t('thread.noLinks')}</span>}
        </p>
      </header>

      <ol aria-label={t('thread.messages')} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {c.messages.map((m) => (
          <li key={m.id} className={cn('flex flex-col gap-1', m.direction === 'Out' ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm [overflow-wrap:anywhere]',
                m.direction === 'Out'
                  ? 'bg-[color-mix(in_oklab,var(--color-brand-500)_12%,var(--color-surface))] text-[var(--color-text)]'
                  : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]',
              )}
            >
              {m.body}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <DateText value={m.at} kind="datetime" />
              {m.isAutoReply && <span>{t('thread.autoReply')}</span>}
              {m.delivery && <StatusBadge domain="mensaje" status={m.delivery.status} />}
              {m.delivery?.reason && <span>{m.delivery.reason}</span>}
            </div>
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => void send(e)} className="space-y-2 border-t border-[var(--color-border)] p-3 sm:p-4" noValidate>
        {error != null && <ErrorNotice error={error} fallback={t('thread.error')} />}
        {c.replyRoute ? (
          <p className="text-xs text-[var(--color-muted)]">
            {t('thread.route', { channel: t(`routeChannels.${c.replyRoute.channel}`), to: c.replyRoute.to })}
          </p>
        ) : (
          <p role="alert" className="rounded-lg bg-[color-mix(in_oklab,var(--color-warning)_14%,var(--color-surface))] p-2 text-xs text-[var(--color-text)]">
            {t(`blocked.${c.replyBlockedReason ?? 'NO_REPLY_CHANNEL'}`)}
          </p>
        )}
        <Textarea
          aria-label={t('thread.reply')}
          placeholder={t('thread.replyPlaceholder')}
          rows={3}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!c.replyRoute}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select
            aria-label={t('thread.quickReplies')}
            value=""
            onChange={(e) => insertQuickReply(e.target.value)}
            disabled={!c.replyRoute || quickReplies.length === 0}
            className="w-auto max-w-[60%]"
          >
            <option value="">{t('thread.quickRepliesPlaceholder')}</option>
            {quickReplies.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={sending || !c.replyRoute || !text.trim()}>
            {sending ? t('thread.sending') : t('thread.send')}
          </Button>
        </div>
      </form>

      {linking && <LinkDialog conversation={c} onClose={() => setLinking(false)} onLinked={onChanged} />}
    </section>
  );
}
