'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { ConversationListItem } from '@/lib/inbox';
import { DateText } from '@/components/ui/date-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { SlaBadge } from './sla-badge';

const CHANNEL_ICON: Record<string, IconName> = { WhatsApp: 'phone', Email: 'mail', Web: 'country', Telefono: 'phone' };

interface ConversationListProps {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  slaMinutes: number;
  now: Date;
}

/** Lista de consultas de la bandeja: canal, quién escribió, el último mensaje, el estado y el plazo. */
export function ConversationList({ items, selectedId, onSelect, slaMinutes, now }: ConversationListProps) {
  const t = useTranslations('inbox');
  return (
    <ul aria-label={t('list.label')} className="divide-y divide-[var(--color-border)]">
      {items.map((c) => {
        const selected = c.id === selectedId;
        const title = c.counterpartName || c.address;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full flex-col gap-1.5 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-sunken)]',
                selected && 'bg-[var(--color-surface-sunken)]',
              )}
            >
              <span className="flex items-center gap-2">
                <Icon name={CHANNEL_ICON[c.channel] ?? 'mail'} size={14} className="shrink-0 text-[var(--color-muted)]" />
                <span className={cn('min-w-0 flex-1 truncate text-sm text-[var(--color-text)]', c.unread > 0 && 'font-semibold')}>
                  {title}
                </span>
                <DateText value={c.lastMessageAt} kind="datetime" className="shrink-0 text-xs text-[var(--color-muted)]" />
                {c.unread > 0 && (
                  <span
                    aria-label={t('list.unread', { count: c.unread })}
                    className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand-500 px-1.5 text-[0.65rem] font-semibold leading-5 text-white"
                  >
                    {c.unread}
                  </span>
                )}
              </span>
              {c.subject && <span className="truncate text-xs font-medium text-[var(--color-text)]">{c.subject}</span>}
              {c.preview && <span className="line-clamp-2 text-xs text-[var(--color-muted)]">{c.preview}</span>}
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{t(`channels.${c.channel}`)}</span>
                <StatusBadge domain="consulta" status={c.status} />
                <SlaBadge conversation={c} slaMinutes={slaMinutes} now={now} />
                <span className="text-xs text-[var(--color-muted)]">{c.assigneeName ?? t('list.unassigned')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
