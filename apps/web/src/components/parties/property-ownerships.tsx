'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CreatePropertyOwnershipSchema, FULL_SHARE_UNITS, pctToUnits } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { formatPercent } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PersonPicker } from './person-picker';
import { orNull, partyFormSchema } from './party-forms';
import { personName, type PartyPerson, type PropertyOwnership } from './parties';

interface OwnershipValues {
  personId: string;
  sharePct: string;
  title: string;
  since: string;
  until: string;
}

const EMPTY: OwnershipValues = { personId: '', sharePct: '', title: '', since: '', until: '' };

/** Porcentajes cargados (los titulares sin porcentaje no cuentan) y si cierran en 100. */
export function ownershipShareSummary(items: Pick<PropertyOwnership, 'sharePct'>[]) {
  const withShare = items.filter((o) => o.sharePct != null && o.sharePct !== '');
  const units = withShare.reduce((acc, o) => acc + pctToUnits(o.sharePct as string | number), 0);
  return { count: withShare.length, units, balanced: withShare.length === 0 || units === FULL_SHARE_UNITS };
}

function OwnershipDialog({
  propertyId,
  onClose,
  onSaved,
}: {
  propertyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('parties.ownerships');
  const tCommon = useTranslations('common');
  const [person, setPerson] = useState<PartyPerson | null>(null);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: partyFormSchema<Record<string, unknown>>(CreatePropertyOwnershipSchema, (v: OwnershipValues) => ({
      personId: v.personId || undefined,
      sharePct: v.sharePct.trim() === '' ? null : v.sharePct.trim().replace(',', '.'),
      title: orNull(v.title),
      since: v.since || null,
      until: v.until || null,
    })),
    initialValues: EMPTY,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    await apiClient(`/properties/${propertyId}/ownerships`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('saved'));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting}>
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('addTitle')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('saveError')} />}
          <PersonPicker
            label={t('fields.person')}
            value={person}
            error={errors.personId}
            onChange={(p) => {
              setPerson(p);
              set('personId', p?.id ?? '');
            }}
          />
          <FormField label={t('fields.sharePct')} hint={t('sharePctHint')} error={errors.sharePct}>
            {(c) => (
              <Input {...c} inputMode="decimal" placeholder="50" value={values.sharePct} onChange={(e) => set('sharePct', e.target.value)} />
            )}
          </FormField>
          <FormField label={t('fields.title')} error={errors.title}>
            {(c) => <Input {...c} value={values.title} onChange={(e) => set('title', e.target.value)} />}
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('fields.since')} error={errors.since}>
              {(c) => <Input {...c} type="date" value={values.since} onChange={(e) => set('since', e.target.value)} />}
            </FormField>
            <FormField label={t('fields.until')} error={errors.until}>
              {(c) => <Input {...c} type="date" value={values.until} onChange={(e) => set('until', e.target.value)} />}
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Titulares de la propiedad. Es informativo: no decide pagos ni se exige que los porcentajes sumen 100. */
export function PropertyOwnerships({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const t = useTranslations('parties.ownerships');
  const locale = useLocale();
  const confirm = useConfirm();
  const [items, setItems] = useState<PropertyOwnership[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiClient<PropertyOwnership[]>(`/properties/${propertyId}/ownerships`);
      setItems(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(o: PropertyOwnership) {
    const ok = await confirm({
      title: t('removeTitle'),
      body: t('removeBody', { name: personName(o.person) }),
      confirmLabel: t('remove'),
      tone: 'danger',
    });
    if (!ok) return;
    setActionError(null);
    try {
      await apiClient(`/properties/${propertyId}/ownerships/${o.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setActionError(err);
    }
  }

  const columns: DataTableColumn<PropertyOwnership>[] = [
    {
      key: 'person',
      header: t('columns.person'),
      render: (o) => (
        <Link href={`/persons/${o.person.id}`} className="font-medium text-brand-600 hover:text-brand-700">
          {personName(o.person)}
        </Link>
      ),
    },
    {
      key: 'share',
      header: t('columns.share'),
      alignRight: true,
      render: (o) => (o.sharePct != null ? formatPercent(o.sharePct, { decimals: 4, locale }) : '—'),
    },
    { key: 'title', header: t('columns.title'), render: (o) => o.title || '—' },
    {
      key: 'period',
      header: t('columns.period'),
      render: (o) =>
        o.since || o.until ? (
          <span className="whitespace-nowrap">
            {o.since ? <DateText value={o.since} /> : '…'} – {o.until ? <DateText value={o.until} /> : '…'}
          </span>
        ) : (
          '—'
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('actions'),
            render: (o: PropertyOwnership) => (
              <Button variant="ghost" size="sm" onClick={() => void remove(o)} aria-label={t('removeFor', { name: personName(o.person) })}>
                {t('remove')}
              </Button>
            ),
          } satisfies DataTableColumn<PropertyOwnership>,
        ]
      : []),
  ];

  const summary = ownershipShareSummary(items ?? []);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-muted)]">{t('informative')}</p>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            {t('add')}
          </Button>
        )}
      </div>
      {items && !summary.balanced && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('sumWarning', { sum: formatPercent(summary.units / 10_000, { decimals: 4, locale }) })}
        </p>
      )}
      {actionError != null && <ErrorNotice error={actionError} className="mb-3" />}
      <DataTable
        columns={columns}
        items={items ?? []}
        keyExtractor={(o) => o.id}
        loading={items === null && loadError == null}
        error={loadError}
        empty={{ title: t('empty'), iconName: 'persons' }}
      />
      {adding && <OwnershipDialog propertyId={propertyId} onClose={() => setAdding(false)} onSaved={() => void load()} />}
    </div>
  );
}
