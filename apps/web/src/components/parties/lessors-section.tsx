'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatPercent } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { LessorsEditor, type LessorsEditorContract } from './lessors-editor';
import { personName, type ContractLessor, type PartyPerson } from './parties';

interface LessorsSectionProps {
  contract: LessorsEditorContract;
  lessors: ContractLessor[];
  /** Propietarios cargados como parte del contrato (datos viejos), solo si no hay locadores. */
  legacyOwners: PartyPerson[];
  canEdit: boolean;
  onSaved: () => void;
}

function PersonLink({ person }: { person: PartyPerson }) {
  return (
    <Link href={`/persons/${person.id}`} className="font-medium text-brand-600 hover:text-brand-700">
      {personName(person)}
    </Link>
  );
}

/** Locadores del contrato con su porcentaje de cobro, y el editor del conjunto completo. */
export function LessorsSection({ contract, lessors, legacyOwners, canEdit, onSaved }: LessorsSectionProps) {
  const t = useTranslations('parties.lessors');
  const tCap = useTranslations('parties.capacity');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);

  const columns: DataTableColumn<ContractLessor>[] = [
    {
      key: 'person',
      header: t('columns.person'),
      render: (l) => (
        <span className="flex flex-wrap items-center gap-2">
          <PersonLink person={l.person} />
          {l.needsReview && <Badge variant="warning">{t('needsReview')}</Badge>}
        </span>
      ),
    },
    { key: 'capacity', header: t('columns.capacity'), render: (l) => tCap(l.capacity) },
    {
      key: 'payoutPct',
      header: t('columns.payoutPct'),
      alignRight: true,
      render: (l) => formatPercent(l.payoutPct, { decimals: 4, locale }),
    },
    {
      key: 'payee',
      header: t('columns.payee'),
      render: (l) => (l.payee ? <PersonLink person={l.payee} /> : <span className="text-[var(--color-muted)]">{t('payeeSelf')}</span>),
    },
    {
      key: 'account',
      header: t('columns.account'),
      render: (l) =>
        l.bankAccount ? (
          [l.bankAccount.currency, l.bankAccount.bankName, l.bankAccount.alias ?? l.bankAccount.cbu?.slice(-6)]
            .filter(Boolean)
            .join(' · ')
        ) : (
          <span className="text-[var(--color-muted)]">{t('noAccount')}</span>
        ),
    },
    {
      key: 'validity',
      header: t('columns.validity'),
      render: (l) => (
        <span className="whitespace-nowrap">
          <DateText value={l.validFrom} /> – {l.validTo ? <DateText value={l.validTo} /> : t('openEnded')}
        </span>
      ),
    },
  ];

  const needsReview = lessors.some((l) => l.needsReview);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contract-lessors-title" role="region">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="contract-lessors-title" className="text-sm font-semibold text-slate-900">
          {t('title')}
        </h2>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {lessors.length > 0 ? t('edit') : t('load')}
          </Button>
        )}
      </div>

      {needsReview && <p className="mb-3 text-sm text-amber-700">{t('needsReviewHint')}</p>}

      {lessors.length > 0 ? (
        <DataTable
          columns={columns}
          items={lessors}
          keyExtractor={(l) => l.id}
          cardRenderer={(l) => (
            <div className="space-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <PersonLink person={l.person} />
                {l.needsReview && <Badge variant="warning">{t('needsReview')}</Badge>}
              </div>
              <p className="text-[var(--color-muted)]">
                {tCap(l.capacity)} · {formatPercent(l.payoutPct, { decimals: 4, locale })}
              </p>
              {l.payee && (
                <p>
                  {t('columns.payee')}: <PersonLink person={l.payee} />
                </p>
              )}
            </div>
          )}
        />
      ) : legacyOwners.length > 0 ? (
        <div>
          <p className="mb-2 text-sm text-amber-700">{t('legacyHint')}</p>
          <ul className="space-y-1">
            {legacyOwners.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <PersonLink person={p} />
                <Badge variant="neutral">{t('toMigrate')}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm italic text-slate-400">{t('empty')}</p>
      )}

      {canEdit && (
        <LessorsEditor
          open={editing}
          onClose={() => setEditing(false)}
          contract={contract}
          lessors={lessors}
          legacyOwners={legacyOwners}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
