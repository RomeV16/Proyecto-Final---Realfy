'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { personName, type PartyPerson, type PowerOfAttorney } from './parties';

function PersonLink({ person }: { person?: PartyPerson }) {
  if (!person) return <span>—</span>;
  return (
    <Link href={`/persons/${person.id}`} className="font-medium text-brand-600 hover:text-brand-700">
      {personName(person)}
    </Link>
  );
}

/** Poderes vigentes que aplican al contrato: los propios del contrato y los generales de cada locador. */
export function ContractPowersSection({ powers }: { powers: PowerOfAttorney[] }) {
  const t = useTranslations('parties.powers');
  const tScope = useTranslations('parties.scopes');
  const tMode = useTranslations('parties.signatureModes');

  const columns: DataTableColumn<PowerOfAttorney>[] = [
    { key: 'principal', header: t('columns.principal'), render: (p) => <PersonLink person={p.principal} /> },
    { key: 'agent', header: t('columns.agent'), render: (p) => <PersonLink person={p.agent} /> },
    {
      key: 'scopes',
      header: t('columns.scopes'),
      render: (p) => (
        <span className="flex flex-wrap gap-1">
          {p.scopes.map((s) => (
            <Badge key={s} variant="info">
              {tScope(s)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'signature',
      header: t('columns.signature'),
      render: (p) => (
        <span>
          {tMode(p.signatureMode)}
          {p.groupKey ? <span className="text-[var(--color-muted)]"> · {t('group', { key: p.groupKey })}</span> : null}
        </span>
      ),
    },
    {
      key: 'applies',
      header: t('columns.applies'),
      render: (p) => (p.contractId ? t('appliesContract') : p.propertyId ? t('appliesProperty') : t('appliesGeneral')),
    },
    {
      key: 'validity',
      header: t('columns.validity'),
      render: (p) => (
        <span className="whitespace-nowrap">
          <DateText value={p.validFrom} /> – {p.validTo ? <DateText value={p.validTo} /> : t('openEnded')}
        </span>
      ),
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6" role="region" aria-labelledby="contract-powers-title">
      <h2 id="contract-powers-title" className="mb-3 text-sm font-semibold text-slate-900">
        {t('contractTitle')}
      </h2>
      {powers.length === 0 ? (
        <p className="text-sm italic text-slate-400">{t('contractEmpty')}</p>
      ) : (
        <DataTable
          columns={columns}
          items={powers}
          keyExtractor={(p) => p.id}
          cardRenderer={(p) => (
            <div className="space-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
              <p>
                <PersonLink person={p.agent} /> <span className="text-[var(--color-muted)]">{t('on', { name: p.principal ? personName(p.principal) : '' })}</span>
              </p>
              <p className="text-[var(--color-muted)]">
                {p.scopes.map((s) => tScope(s)).join(', ')} · {tMode(p.signatureMode)}
              </p>
            </div>
          )}
        />
      )}
    </div>
  );
}
