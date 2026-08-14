'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { StatTile, StatTileSkeleton } from '@/components/ui/stat-tile';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { ListTransition } from '@/components/ui/motion';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { usePortalAuth } from '@/lib/portal-auth-context';
import { AccountStatus } from '@/components/portal/account-status';
import { ContractCard } from '@/components/portal/contract-card';
import { InvoiceRow } from '@/components/portal/invoice-row';
import { ClaimRow } from '@/components/portal/claim-row';
import { NewClaimDialog } from '@/components/portal/new-claim-dialog';
import { SectionHead } from '@/components/portal/portal-primitives';
import {
  formatDayMonth,
  usePortalOverview,
  usePortalPaths,
} from '@/components/portal/portal-data';

/**
 * Portal home — the whole tenant situation on one screen.
 *
 * Order follows urgency: what you owe, what happens next, what your claim is
 * doing, then the contract you signed. Each block has at most one action.
 */
export default function PortalHomePage() {
  const t = useTranslations();
  const { person } = usePortalAuth();
  const paths = usePortalPaths();
  const queryClient = useQueryClient();
  const { overview, invoices, claims, isLoading, isError } = usePortalOverview();
  const [claimFormOpen, setClaimFormOpen] = useState(false);

  const { state, nextInvoice, daysToNext, openClaims, focusClaim } = overview;

  // The tile answers "what comes next", so it only ever shows a future due
  // date — anything already late is the account panel's job.
  const dueHint = nextInvoice
    ? t('portal.home.dueIn', { days: Math.max(0, daysToNext ?? 0) })
    : overview.overdueCount > 0
      ? t('portal.home.allOverdue')
      : t('portal.home.nothingDue');

  const claimHint = focusClaim
    ? t(`portal.claims.statuses.${focusClaim.status}` as Parameters<typeof t>[0])
    : t('portal.home.noClaims');

  if (isError) {
    return (
      <EmptyState iconName="alert" title={t('common.error')} subtitle={t('portal.common.error')} />
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">{t('portal.common.brand')}</p>
        <h1 className="h2 mt-2">
          {t('portal.home.greeting', { name: person?.firstName || '' })}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">
          {overview.propertyLabel ?? t('portal.home.subtitle')}
        </p>
      </header>

      <AccountStatus overview={overview} loading={isLoading} />

      <ListTransition
        state={isLoading ? 'loading' : 'ready'}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTileSkeleton />
            <StatTileSkeleton />
          </div>
        }
        empty={null}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label={t('portal.home.nextDue')}
            value={nextInvoice ? formatDayMonth(nextInvoice.dueDate) : '—'}
            icon="calendarClock"
            tone={nextInvoice ? 'warning' : state === 'overdue' ? 'danger' : 'success'}
            hint={dueHint}
            href={paths.invoices}
          />
          <StatTile
            label={t('portal.home.openClaims')}
            value={openClaims}
            icon="tickets"
            tone={openClaims > 0 ? 'info' : 'neutral'}
            hint={claimHint}
            href={paths.claims}
          />
        </div>
      </ListTransition>

      <section>
        <SectionHead
          title={t('portal.home.recentInvoices')}
          href={paths.invoices}
          linkLabel={t('portal.home.viewAllInvoices')}
        />
        <RowList
          items={invoices.slice(0, 3)}
          loading={isLoading}
          skeletonCount={3}
          keyOf={(invoice) => invoice.id}
          renderItem={(invoice) => <InvoiceRow invoice={invoice} href={paths.invoices} />}
          empty={
            <EmptyState
              iconName="invoices"
              title={t('portal.invoices.empty')}
              subtitle={t('portal.invoices.emptySubtitle')}
            />
          }
        />
      </section>

      <section>
        <SectionHead
          title={t('portal.home.yourClaims')}
          href={paths.claims}
          linkLabel={t('portal.home.viewAllClaims')}
        />
        <RowList
          items={claims.slice(0, 2)}
          loading={isLoading}
          skeletonCount={2}
          keyOf={(claim) => claim.id}
          renderItem={(claim) => <ClaimRow claim={claim} />}
          empty={
            <EmptyState
              iconName="tickets"
              title={t('portal.claims.empty')}
              subtitle={t('portal.claims.emptySubtitle')}
              action={
                <Button onClick={() => setClaimFormOpen(true)}>
                  <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                  {t('portal.claims.newClaim')}
                </Button>
              }
            />
          }
        />
      </section>

      <section>
        <SectionHead title={t('portal.contract.title')} />
        <ContractCard overview={overview} loading={isLoading} />
      </section>

      <NewClaimDialog
        open={claimFormOpen}
        onClose={() => setClaimFormOpen(false)}
        onCreated={() => {
          setClaimFormOpen(false);
          queryClient.invalidateQueries({ queryKey: ['portal', 'tickets'] });
        }}
      />
    </div>
  );
}
