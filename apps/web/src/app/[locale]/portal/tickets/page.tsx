'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { ClaimRow } from '@/components/portal/claim-row';
import { NewClaimDialog } from '@/components/portal/new-claim-dialog';
import { CLAIM_PAGE_SIZE, isClaimOpen, usePortalClaims } from '@/components/portal/portal-data';

/**
 * Claims.
 *
 * One list, one button. Every row states where the claim stands and what
 * happens next, so the tenant never has to open a detail view to find out
 * whether anyone is looking at it.
 */
export default function PortalClaimsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(CLAIM_PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);

  const { data, isPending, isFetching, isError } = usePortalClaims(limit);

  const items = useMemo(() => data?.data ?? [], [data]);
  const total = data?.meta?.total ?? 0;
  const openCount = items.filter(isClaimOpen).length;

  if (isError) {
    return (
      <EmptyState iconName="alert" title={t('common.error')} subtitle={t('portal.common.error')} />
    );
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{t('portal.common.brand')}</p>
          <h1 className="h2 mt-2">{t('portal.claims.title')}</h1>
          <p className="mt-1.5 text-sm text-[var(--color-muted)]">
            {isPending
              ? t('portal.claims.subtitle')
              : openCount > 0
                ? t('portal.claims.openSummary', { count: openCount })
                : t('portal.claims.allClosed')}
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setFormOpen(true)}>
          <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
          {t('portal.claims.newClaim')}
        </Button>
      </header>

      <div className="mt-6">
        <RowList
          items={items}
          loading={isPending}
          busy={isFetching && !isPending}
          skeletonCount={3}
          keyOf={(claim) => claim.id}
          renderItem={(claim) => <ClaimRow claim={claim} />}
          empty={
            <EmptyState
              iconName="tickets"
              title={t('portal.claims.empty')}
              subtitle={t('portal.claims.emptySubtitle')}
              steps={[
                t('portal.claims.step1'),
                t('portal.claims.step2'),
                t('portal.claims.step3'),
              ]}
              action={
                <Button onClick={() => setFormOpen(true)}>
                  <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                  {t('portal.claims.newClaim')}
                </Button>
              }
            />
          }
        />
      </div>

      {items.length < total && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => setLimit((current) => current + CLAIM_PAGE_SIZE)}
            disabled={isFetching}
          >
            {t('portal.claims.loadMore')}
          </Button>
        </div>
      )}

      <NewClaimDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false);
          queryClient.invalidateQueries({ queryKey: ['portal', 'tickets'] });
        }}
      />
    </div>
  );
}
