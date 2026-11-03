'use client';

import { useTranslations } from 'next-intl';
import type { CollectionCaseItem } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { caseHref, overdueTone } from '@/lib/collections';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';

interface Props {
  items: CollectionCaseItem[];
  loading: boolean;
  error?: unknown;
  pagination?: DataTablePagination;
}

/** Texto de lo que toca después en un caso: la acción y el día, o por qué no hay una. */
export function NextActionText({ item }: { item: Pick<CollectionCaseItem, 'nextAction' | 'nextActionAt' | 'planStatus' | 'pausedUntil'> }) {
  const t = useTranslations('collections');
  if (item.planStatus === 'Paused' && item.pausedUntil) {
    return (
      <span>
        {t('plan.Paused')} <DateText value={item.pausedUntil} />
      </span>
    );
  }
  if (item.planStatus === 'AwaitingLetterConfirmation') return <span>{t('plan.AwaitingLetterConfirmation')}</span>;
  if (item.planStatus === 'Manual') return <span>{t('plan.Manual')}</span>;
  if (!item.nextAction) return <span className="text-[var(--color-muted)]">{t('plan.none')}</span>;
  return (
    <span>
      {t(`actionKinds.${item.nextAction}`)}
      {item.nextActionAt && (
        <>
          {' · '}
          <DateText value={item.nextActionAt} />
        </>
      )}
    </span>
  );
}

/**
 * Casos de cobranza: el contrato con su inquilino, la etapa, los días de mora y lo que se debe hoy (saldo vencido
 * y total con punitorios), con lo que toca después. Cada fila lleva al detalle del caso.
 */
export function CaseTable({ items, loading, error, pagination }: Props) {
  const t = useTranslations('collections');
  const columns: DataTableColumn<CollectionCaseItem>[] = [
    {
      key: 'contract',
      header: t('columns.contract'),
      render: (c) => (
        <div className="min-w-0">
          <Link href={caseHref(c.id)} className="font-medium text-[var(--color-brand-600)] hover:underline">
            {c.propertyLabel || t('noProperty')}
          </Link>
          <p className="text-xs text-[var(--color-muted)]">{c.tenantNames || t('noTenant')}</p>
        </div>
      ),
    },
    { key: 'stage', header: t('columns.stage'), render: (c) => <StatusBadge domain="cobranza" status={c.stage} /> },
    {
      key: 'overdue',
      header: t('columns.overdue'),
      alignRight: true,
      render: (c) => <Badge variant={overdueTone(c.daysOverdue)}>{t('days', { n: c.daysOverdue })}</Badge>,
    },
    {
      key: 'balance',
      header: t('columns.balance'),
      alignRight: true,
      render: (c) => <MoneyText value={c.balance} currency={c.currency} decimals={2} />,
    },
    {
      key: 'payoff',
      header: t('columns.payoff'),
      alignRight: true,
      render: (c) => <MoneyText value={c.payoffToday} currency={c.currency} decimals={2} className="font-semibold" />,
    },
    { key: 'next', header: t('columns.next'), render: (c) => <NextActionText item={c} /> },
    { key: 'assignee', header: t('columns.assignee'), render: (c) => c.assigneeName ?? '—' },
  ];

  return (
    <DataTable
      items={items}
      columns={columns}
      keyExtractor={(c) => c.id}
      loading={loading}
      error={error}
      pagination={pagination}
      empty={{ title: t('empty.title'), subtitle: t('empty.subtitle'), iconName: 'delinquency' }}
    />
  );
}
