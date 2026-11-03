'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import type { ListingsOverview, OverviewListing } from '@/lib/listings';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusBadge } from '@/components/ui/status-badge';
import { PortalsSettingsDialog } from './portals-settings-dialog';

function Section({
  title,
  hint,
  count,
  action,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {title} <span className="tabular-nums text-[var(--color-muted)]">({count})</span>
          </h2>
          <p className="text-sm text-[var(--color-muted)]">{hint}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * Publicaciones: qué unidades disponibles no están publicadas en ningún lado, qué avisos están por vencer o
 * vencidos y qué hay publicado de lo que ya se alquiló o vendió (hay que pausarlo).
 */
export function ListingsScreen() {
  const t = useTranslations('publication');
  const tOps = useTranslations('properties.operationTypes');
  const tStates = useTranslations('properties.states');
  const confirm = useConfirm();
  const canManage = useCan('listings.manage');
  const canConfigure = useCan('operationalDefaults.manage');
  const [data, setData] = useState<ListingsOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pausing, setPausing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiClient<ListingsOverview>('/listings/overview'));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pauseAll() {
    if (!data) return;
    const ok = await confirm({
      title: t('overview.pauseTitle'),
      body: t('overview.pauseBody', { count: data.counts.shouldPause }),
      confirmLabel: t('overview.pauseConfirm'),
    });
    if (!ok) return;
    setPausing(true);
    try {
      const result = await apiClient<{ paused: number }>('/listings/pause-unavailable', { method: 'POST' });
      toast.success(t('overview.paused', { count: result.paused }));
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPausing(false);
    }
  }

  const listingRows = (rows: OverviewListing[], showState = false) => (
    <ul className="divide-y divide-[var(--color-border)] text-sm">
      {rows.map((r) => (
        <li key={r.listingId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <Link
            href={`/properties/${r.propertyId}`}
            className="min-w-0 flex-1 basis-48 font-medium text-[var(--color-text)] hover:underline [overflow-wrap:anywhere]"
          >
            {r.title}
          </Link>
          <span className="text-[var(--color-muted)]">
            {tOps(r.operationType)} · {r.portalName}
          </span>
          <StatusBadge domain="aviso" status={r.status} />
          {r.expiresAt && (
            <span className="text-xs text-[var(--color-muted)]">
              {t('card.expires')} <DateText value={r.expiresAt} />
            </span>
          )}
          {showState && (
            <span className="text-xs text-[var(--color-muted)]">
              {r.operationState && tStates.has(r.operationState) ? tStates(r.operationState) : t('overview.noOperation')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h2">{t('overview.title')}</h1>
          <p className="max-w-2xl text-sm text-[var(--color-muted)]">{t('overview.subtitle')}</p>
        </div>
        {canConfigure && (
          <Button type="button" variant="secondary" onClick={() => setSettingsOpen(true)}>
            {t('overview.configure')}
          </Button>
        )}
      </header>

      {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
      {error == null && !data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('overview.tiles.published')} value={data.counts.published} icon="megaphone" tone="success" />
            <StatTile label={t('overview.tiles.notPublished')} value={data.counts.notPublished} icon="properties" tone="warning" />
            <StatTile label={t('overview.tiles.expiring')} value={data.counts.expiring + data.counts.expired} icon="calendarClock" tone="danger" />
            <StatTile label={t('overview.tiles.shouldPause')} value={data.counts.shouldPause} icon="alert" tone="danger" />
          </div>

          {data.perPortal.length > 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              {data.perPortal.map((p) => `${p.portalName}: ${p.count}`).join(' · ')}
            </p>
          )}

          <Section
            title={t('overview.shouldPause.title')}
            hint={t('overview.shouldPause.hint')}
            count={data.shouldPause.length}
            action={
              canManage && data.shouldPause.length > 0 ? (
                <Button type="button" size="sm" variant="danger" disabled={pausing} onClick={() => void pauseAll()}>
                  {t('overview.pauseAll')}
                </Button>
              ) : undefined
            }
          >
            {data.shouldPause.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('overview.none')}</p>
            ) : (
              listingRows(data.shouldPause, true)
            )}
          </Section>

          <Section
            title={t('overview.expired.title')}
            hint={t('overview.expired.hint')}
            count={data.expired.length}
          >
            {data.expired.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('overview.none')}</p>
            ) : (
              listingRows(data.expired)
            )}
          </Section>

          <Section
            title={t('overview.expiring.title')}
            hint={t('overview.expiring.hint', { days: data.expiryWarnDays })}
            count={data.expiring.length}
          >
            {data.expiring.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('overview.none')}</p>
            ) : (
              listingRows(data.expiring)
            )}
          </Section>

          <Section
            title={t('overview.notPublished.title')}
            hint={t('overview.notPublished.hint')}
            count={data.notPublished.length}
          >
            {data.notPublished.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('overview.none')}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] text-sm">
                {data.notPublished.map((r) => (
                  <li key={`${r.propertyId}:${r.operationType}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <Link
                      href={`/properties/${r.propertyId}`}
                      className="min-w-0 flex-1 basis-48 font-medium text-[var(--color-text)] hover:underline [overflow-wrap:anywhere]"
                    >
                      {r.title}
                    </Link>
                    <span className="text-[var(--color-muted)]">
                      {tOps(r.operationType)}
                      {r.city ? ` · ${r.city}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {settingsOpen && (
        <PortalsSettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}
