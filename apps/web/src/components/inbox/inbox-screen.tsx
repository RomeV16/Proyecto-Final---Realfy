'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { InboxSettings } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  EMPTY_INBOX_FILTERS,
  INBOX_CHANNELS,
  INBOX_STATUSES,
  inboxQuery,
  useNow,
  type ConversationDetail,
  type ConversationPage,
  type InboxFilters,
} from '@/lib/inbox';
import { refreshInboxSummary, useInboxSummary } from '@/lib/inbox-summary';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useStaffUsers } from '@/components/fees/use-staff-users';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';
import { RegisterCallDialog } from './register-call-dialog';

/** Cada cuánto se vuelve a leer la lista (llegan consultas mientras la pantalla está abierta). */
const LIST_REFRESH_MS = 30_000;

const FALLBACK_SETTINGS: Pick<InboxSettings, 'slaMinutes' | 'quickReplies'> = { slaMinutes: 15, quickReplies: [] };

/**
 * Bandeja de consultas: a la izquierda las consultas de WhatsApp, mail, micrositio y teléfono con su plazo; a la
 * derecha el hilo de la elegida, con el responsable, el estado y el cuadro para responder.
 */
export function InboxScreen() {
  const t = useTranslations('inbox');
  const { user } = useAuth();
  const canAccess = useCan('inbox.access');
  const canConfigure = useCan('inbox.configure');
  const staff = useStaffUsers(canConfigure);
  const now = useNow(1000);
  const summary = useInboxSummary(canAccess);

  const [filters, setFilters] = useState<InboxFilters>(EMPTY_INBOX_FILTERS);
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [settings, setSettings] = useState(FALLBACK_SETTINGS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [calling, setCalling] = useState(false);

  const query = inboxQuery(filters);

  const loadList = useCallback(async () => {
    try {
      setPage(await apiClient<ConversationPage>(`/conversations?${query}`));
      setListError(null);
    } catch (err) {
      setListError(err);
    }
  }, [query]);

  useEffect(() => {
    if (!canAccess) return;
    void loadList();
    const id = setInterval(() => void loadList(), LIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [canAccess, loadList]);

  useEffect(() => {
    if (!canAccess) return;
    void (async () => {
      try {
        setSettings(await apiClient<InboxSettings>('/conversations/settings'));
      } catch {
        // Sin configuración se usa el plazo de fábrica; la lista y el hilo siguen funcionando.
      }
    })();
  }, [canAccess]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const d = await apiClient<ConversationDetail>(`/conversations/${id}`);
        setDetail(d);
        setDetailError(null);
        if (d.unread > 0) {
          await apiClient(`/conversations/${id}/read`, { method: 'POST' });
          void refreshInboxSummary();
          void loadList();
        }
      } catch (err) {
        setDetailError(err);
      }
    },
    [loadList],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const changed = useCallback(() => {
    void loadList();
    void refreshInboxSummary();
    if (selectedId) void loadDetail(selectedId);
  }, [loadList, loadDetail, selectedId]);

  function setFilter<K extends keyof InboxFilters>(key: K, value: InboxFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  if (!canAccess) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const showThread = selectedId !== null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h2">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canConfigure && (
            <Link href="/configuracion/bandeja">
              <Button type="button" variant="secondary">
                {t('configure')}
              </Button>
            </Link>
          )}
          <Button type="button" onClick={() => setCalling(true)}>
            {t('call.open')}
          </Button>
        </div>
      </header>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-muted)]" aria-live="polite">
        <span>{t('summary.unread', { count: summary.unread })}</span>
        <span className={cn(summary.breached > 0 && 'font-medium text-[var(--color-danger)]')}>
          {t('summary.breached', { count: summary.breached })}
        </span>
        <span>{t('summary.unassigned', { count: summary.unassigned })}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2" role="search" aria-label={t('filters.label')}>
        <Input
          aria-label={t('filters.search')}
          placeholder={t('filters.search')}
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          className="min-w-0 flex-1 basis-48"
        />
        <Select
          aria-label={t('filters.scope')}
          value={filters.status || filters.scope}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'open' || v === 'all') setFilters((f) => ({ ...f, scope: v, status: '' }));
            else setFilters((f) => ({ ...f, status: v as InboxFilters['status'] }));
          }}
          className="w-auto"
        >
          <option value="open">{t('filters.open')}</option>
          <option value="all">{t('filters.all')}</option>
          {INBOX_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.channel')}
          value={filters.channel}
          onChange={(e) => setFilter('channel', e.target.value as InboxFilters['channel'])}
          className="w-auto"
        >
          <option value="">{t('filters.anyChannel')}</option>
          {INBOX_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`channels.${c}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.assignee')}
          value={filters.assignee}
          onChange={(e) => setFilter('assignee', e.target.value as InboxFilters['assignee'])}
          className="w-auto"
        >
          <option value="">{t('filters.anyAssignee')}</option>
          <option value="me">{t('filters.mine')}</option>
          <option value="none">{t('filters.unassigned')}</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <input type="checkbox" checked={filters.slaBreached} onChange={(e) => setFilter('slaBreached', e.target.checked)} />
          {t('filters.breached')}
        </label>
      </div>

      {listError != null && <ErrorNotice error={listError} fallback={t('loadError')} />}

      <div className="grid min-h-[32rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:h-[calc(100vh-18rem)] lg:grid-cols-[minmax(18rem,26rem)_1fr]">
        <div className={cn('min-h-0 overflow-y-auto border-[var(--color-border)] lg:border-r', showThread && 'hidden lg:block')}>
          {listError == null && !page && <Skeleton className="m-3 h-40" />}
          {page && page.items.length === 0 && (
            <EmptyState variant="filtered" iconName="inbox" title={t('empty.title')} subtitle={t('empty.subtitle')} />
          )}
          {page && page.items.length > 0 && (
            <ConversationList
              items={page.items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              slaMinutes={settings.slaMinutes}
              now={now}
            />
          )}
        </div>
        <div className={cn('min-h-0', !showThread && 'hidden lg:block')}>
          {detailError != null && <ErrorNotice error={detailError} fallback={t('loadDetailError')} className="m-3" />}
          {detail && (
            <ConversationThread
              conversation={detail}
              slaMinutes={settings.slaMinutes}
              now={now}
              quickReplies={settings.quickReplies}
              userId={user?.id ?? ''}
              canAssign={canConfigure}
              staff={staff}
              onChanged={changed}
              onBack={() => setSelectedId(null)}
            />
          )}
          {!detail && detailError == null && (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-[var(--color-muted)]">{t('thread.select')}</p>
            </div>
          )}
        </div>
      </div>

      {calling && (
        <RegisterCallDialog
          onClose={() => setCalling(false)}
          onSaved={(created) => {
            setSelectedId(created.id);
            void loadList();
            void refreshInboxSummary();
          }}
        />
      )}
    </div>
  );
}
