'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { formatPercent } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { personName, type ContractLessor } from './parties';

interface ContractSummary {
  id: string;
  status: string;
  property?: { title: string } | null;
}

interface Lessorship extends ContractLessor {
  contract: ContractSummary;
}

/** Contratos en los que la persona es locadora, con su porcentaje de cobro. */
export function PersonLessorships({ personId }: { personId: string }) {
  const t = useTranslations('parties.lessorships');
  const tLessors = useTranslations('parties.lessors');
  const tCap = useTranslations('parties.capacity');
  const locale = useLocale();
  const [rows, setRows] = useState<Lessorship[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiClient<{ items: ContractSummary[] }>(`/contracts?personId=${personId}&limit=50`);
        const found = await Promise.all(
          (list.items ?? []).map(async (contract) => {
            const lessors = await apiClient<ContractLessor[]>(`/contracts/${contract.id}/lessors`);
            return (Array.isArray(lessors) ? lessors : [])
              .filter((l) => l.personId === personId)
              .map((l) => ({ ...l, contract }));
          }),
        );
        if (!cancelled) setRows(found.flat());
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const columns: DataTableColumn<Lessorship>[] = [
    {
      key: 'contract',
      header: t('columns.contract'),
      render: (l) => (
        <Link href={`/contracts/${l.contract.id}`} className="font-medium text-brand-600 hover:text-brand-700">
          {l.contract.property?.title ?? l.contract.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'capacity',
      header: t('columns.capacity'),
      render: (l) => (
        <span className="flex flex-wrap items-center gap-2">
          {tCap(l.capacity)}
          {l.needsReview && <Badge variant="warning">{tLessors('needsReview')}</Badge>}
        </span>
      ),
    },
    {
      key: 'payoutPct',
      header: t('columns.payoutPct'),
      alignRight: true,
      render: (l) => formatPercent(l.payoutPct, { decimals: 4, locale }),
    },
    {
      key: 'payee',
      header: t('columns.payee'),
      render: (l) => (l.payee ? personName(l.payee) : <span className="text-[var(--color-muted)]">{tLessors('payeeSelf')}</span>),
    },
    {
      key: 'validity',
      header: t('columns.validity'),
      render: (l) => (
        <span className="whitespace-nowrap">
          <DateText value={l.validFrom} /> – {l.validTo ? <DateText value={l.validTo} /> : tLessors('openEnded')}
        </span>
      ),
    },
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="person-lessorships-title">
      <h3 id="person-lessorships-title" className="mb-3 text-base font-semibold text-slate-900">
        {t('title')}
      </h3>
      <DataTable
        columns={columns}
        items={rows ?? []}
        keyExtractor={(l) => l.id}
        loading={rows === null && error == null}
        error={error}
        empty={{ title: t('empty'), iconName: 'contracts' }}
      />
    </section>
  );
}
