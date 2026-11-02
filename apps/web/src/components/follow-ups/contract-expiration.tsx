'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { Paged } from '@/lib/cash';
import { downloadFile } from '@/lib/download';
import type { FollowUp } from '@/lib/follow-ups';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { FollowUpDrawer } from './follow-up-drawer';
import { OralExtensionDialog } from './oral-extension-dialog';
import { RenewDialog, type RenewGuarantor } from './renew-dialog';

interface Period {
  id: string;
  seq: number;
  kind: string;
  startDate: string;
  endDate: string;
  initialRent: string;
}

interface Props {
  contract: {
    id: string;
    status: string;
    endDate?: string;
    actualEndDate?: string | null;
    rentAmount?: string | number;
    rentCurrency?: string;
    persons: { role: string; person: { id: string; firstName: string; lastName: string } }[];
  };
  /** Recarga el contrato después de una prórroga o una renovación. */
  onChanged: () => void;
}

type Dialog = '' | 'extension' | 'renew' | 'followUp';

/**
 * Vencimiento del contrato: fin pactado y fin real, el seguimiento abierto con su semáforo, la prórroga de palabra,
 * la renovación como período y la adenda corta de cada renovación.
 */
export function ContractExpiration({ contract, onChanged }: Props) {
  const t = useTranslations('followUps');
  const canAdminister = useCan('expirations.administer');
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [dialog, setDialog] = useState<Dialog>('');
  const active = contract.status === 'Activo';
  const signedEnd = contract.endDate ?? '';
  const effectiveEnd = contract.actualEndDate ?? signedEnd;

  const load = useCallback(async () => {
    try {
      const [open, list] = await Promise.all([
        apiClient<Paged<FollowUp>>(`/follow-ups?contractId=${contract.id}&status=Abierto&limit=1`),
        apiClient<Period[]>(`/contracts/${contract.id}/periods`),
      ]);
      setFollowUp(open?.items?.[0] ?? null);
      setPeriods(Array.isArray(list) ? list : []);
    } catch {
      setFollowUp(null);
      setPeriods([]);
    }
  }, [contract.id]);

  useEffect(() => {
    void load();
  }, [load, contract.endDate, contract.actualEndDate]);

  const guarantors: RenewGuarantor[] = contract.persons
    .filter((p) => p.role === 'Garante')
    .map((p) => ({ personId: p.person.id, name: `${p.person.firstName} ${p.person.lastName}`.trim() }));
  const renewals = periods.filter((p) => p.kind === 'Renovacion');

  function changed() {
    void load();
    onChanged();
  }

  return (
    <section
      aria-labelledby="contract-expiration-title"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="contract-expiration-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('card.title')}
        </h2>
        {followUp?.light && <StatusBadge domain="vencimiento" status={followUp.light} />}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[var(--color-muted)]">{t('card.signedEnd')}</dt>
          <dd className="font-medium text-[var(--color-text)]">
            <DateText value={signedEnd} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-muted)]">{t('card.effectiveEnd')}</dt>
          <dd className="font-medium text-[var(--color-text)]">
            <DateText value={effectiveEnd} />
            {contract.actualEndDate && <span className="ml-1.5 text-xs text-[var(--color-muted)]">({t('oralExtension.badge')})</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-muted)]">{t('card.followUp')}</dt>
          <dd className="font-medium text-[var(--color-text)]">
            {followUp ? (
              <>
                {t(`kinds.${followUp.kind}`)} · {followUp.progress.done}/{followUp.progress.total}{' '}
                <button type="button" className="text-[var(--color-brand)] hover:underline" onClick={() => setDialog('followUp')}>
                  {t('open')}
                </button>
              </>
            ) : (
              <span className="font-normal text-[var(--color-muted)]">{t('card.noFollowUp')}</span>
            )}
          </dd>
        </div>
      </dl>

      {renewals.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('card.renewals')}</h3>
          <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] text-sm">
            {renewals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="text-[var(--color-text)]">
                  <DateText value={p.startDate} /> – <DateText value={p.endDate} />
                </span>
                <MoneyText value={p.initialRent} currency={contract.rentCurrency ?? 'ARS'} decimals={2} className="tabular-nums" />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  onClick={() =>
                    void downloadFile(`/contracts/${contract.id}/periods/${p.seq}/addendum`, `adenda-renovacion-${p.seq}.pdf`).catch(() =>
                      toast.error(t('card.addendumFailed')),
                    )
                  }
                >
                  {t('card.addendum')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active && canAdminister && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setDialog('extension')}>
            {t('card.oralExtension')}
          </Button>
          <Button type="button" onClick={() => setDialog('renew')}>
            {t('card.renew')}
          </Button>
        </div>
      )}

      {dialog === 'extension' && (
        <OralExtensionDialog
          contractId={contract.id}
          effectiveEnd={effectiveEnd}
          onClose={() => setDialog('')}
          onSaved={changed}
        />
      )}
      {dialog === 'renew' && (
        <RenewDialog
          contractId={contract.id}
          effectiveEnd={effectiveEnd}
          currentRent={String(contract.rentAmount ?? '')}
          guarantors={guarantors}
          onClose={() => setDialog('')}
          onSaved={changed}
        />
      )}
      {dialog === 'followUp' && followUp && (
        <FollowUpDrawer followUp={followUp} onClose={() => setDialog('')} onChanged={setFollowUp} />
      )}
    </section>
  );
}
