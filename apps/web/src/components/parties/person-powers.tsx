'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CreatePowerOfAttorneySchema,
  PowerScope,
  SignatureMode,
  UpdatePowerOfAttorneySchema,
} from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Link } from '@/i18n/navigation';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PersonPicker } from './person-picker';
import { orNull, partyFormSchema } from './party-forms';
import { dayOf, isCurrent, personName, type PartyPerson, type PowerOfAttorney } from './parties';

type Applies = 'general' | 'contract' | 'property';

interface PowerValues {
  agentId: string;
  scopes: string[];
  signatureMode: string;
  groupKey: string;
  applies: Applies;
  targetId: string;
  validFrom: string;
  validTo: string;
  documentUrl: string;
}

interface Option {
  id: string;
  label: string;
}

const EMPTY: PowerValues = {
  agentId: '',
  scopes: [],
  signatureMode: SignatureMode.Indistinta,
  groupKey: '',
  applies: 'general',
  targetId: '',
  validFrom: '',
  validTo: '',
  documentUrl: '',
};

function toValues(p: PowerOfAttorney): PowerValues {
  return {
    agentId: p.agentId,
    scopes: p.scopes,
    signatureMode: p.signatureMode,
    groupKey: p.groupKey ?? '',
    applies: p.contractId ? 'contract' : p.propertyId ? 'property' : 'general',
    targetId: p.contractId ?? p.propertyId ?? '',
    validFrom: dayOf(p.validFrom),
    validTo: dayOf(p.validTo),
    documentUrl: p.documentUrl ?? '',
  };
}

function PowerDialog({
  principalId,
  power,
  onClose,
  onSaved,
}: {
  principalId: string;
  /** `null` otorga un poder nuevo; con un poder lo edita (el apoderado y el alcance no cambian). */
  power: PowerOfAttorney | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('parties.powers');
  const tScope = useTranslations('parties.scopes');
  const tMode = useTranslations('parties.signatureModes');
  const tCommon = useTranslations('common');
  const editing = power !== null;

  const [agent, setAgent] = useState<PartyPerson | null>(power?.agent ?? null);
  const [options, setOptions] = useState<Option[]>([]);

  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: partyFormSchema<Record<string, unknown>>(
      editing ? UpdatePowerOfAttorneySchema : CreatePowerOfAttorneySchema,
      (v: PowerValues) => {
        const joint = v.signatureMode === SignatureMode.Conjunta;
        return {
          ...(editing
            ? {}
            : {
                agentId: v.agentId || undefined,
                // Vacío no se omite: el esquema lo marca inválido en lugar de tomarlo como poder general.
                contractId: v.applies === 'contract' ? v.targetId : undefined,
                propertyId: v.applies === 'property' ? v.targetId : undefined,
              }),
          scopes: v.scopes,
          signatureMode: v.signatureMode,
          groupKey: joint ? orNull(v.groupKey) : null,
          ...(v.validFrom ? { validFrom: v.validFrom } : {}),
          validTo: v.validTo || null,
          documentUrl: orNull(v.documentUrl),
        };
      },
      { contractId: 'targetId', propertyId: 'targetId' },
    ),
    initialValues: power ? toValues(power) : EMPTY,
    translate: useSchemaMessages(),
  });

  // Contratos de la poderdante o propiedades, según a qué aplique el poder.
  useEffect(() => {
    if (editing || values.applies === 'general') {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const load =
      values.applies === 'contract'
        ? apiClient<{ items: { id: string; startDate: string; property?: { title: string } }[] }>(
            `/contracts?personId=${principalId}&limit=100`,
          ).then((r) =>
            r.items.map((c) => ({ id: c.id, label: `${c.property?.title ?? c.id.slice(0, 8)} · ${dayOf(c.startDate)}` })),
          )
        : apiClient<{ items: { id: string; title: string }[] }>('/properties?limit=100&isActive=true').then((r) =>
            r.items.map((p) => ({ id: p.id, label: p.title })),
          );
    load
      .then((o) => !cancelled && setOptions(o))
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [editing, values.applies, principalId]);

  const save = submit(async (body) => {
    if (editing) {
      await apiClient(`/persons/${principalId}/powers/${power.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await apiClient(`/persons/${principalId}/powers`, { method: 'POST', body: JSON.stringify(body) });
    }
    toast.success(t('saved'));
    onSaved();
    onClose();
  });

  function toggleScope(scope: string, on: boolean) {
    set('scopes', on ? [...values.scopes, scope] : values.scopes.filter((s) => s !== scope));
  }

  return (
    <Dialog open onClose={onClose} busy={submitting} size="lg">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{editing ? t('editTitle') : t('addTitle')}</h2>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto">
          {formError != null && <ErrorNotice error={formError} fallback={t('saveError')} />}
          <PersonPicker
            label={t('fields.agent')}
            value={agent}
            disabled={editing}
            excludeIds={[principalId]}
            error={errors.agentId}
            onChange={(p) => {
              setAgent(p);
              set('agentId', p?.id ?? '');
            }}
          />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">{t('fields.scopes')}</legend>
            <div className="flex flex-wrap gap-4">
              {Object.values(PowerScope).map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={values.scopes.includes(scope)}
                    onChange={(e) => toggleScope(scope, e.target.checked)}
                  />
                  {tScope(scope)}
                </label>
              ))}
            </div>
            {errors.scopes && (
              <p role="alert" className="mt-1 text-xs text-[var(--color-danger)]">
                {errors.scopes}
              </p>
            )}
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('fields.signatureMode')} error={errors.signatureMode}>
              {(c) => (
                <Select {...c} value={values.signatureMode} onChange={(e) => set('signatureMode', e.target.value)}>
                  {Object.values(SignatureMode).map((m) => (
                    <option key={m} value={m}>
                      {tMode(m)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {values.signatureMode === SignatureMode.Conjunta && (
              <FormField label={t('fields.groupKey')} hint={t('groupKeyHint')} error={errors.groupKey}>
                {(c) => <Input {...c} value={values.groupKey} onChange={(e) => set('groupKey', e.target.value)} />}
              </FormField>
            )}
            {!editing && (
              <FormField label={t('fields.applies')}>
                {(c) => (
                  <Select
                    {...c}
                    value={values.applies}
                    onChange={(e) => {
                      set('applies', e.target.value as Applies);
                      set('targetId', '');
                    }}
                  >
                    <option value="general">{t('appliesGeneral')}</option>
                    <option value="contract">{t('appliesContract')}</option>
                    <option value="property">{t('appliesProperty')}</option>
                  </Select>
                )}
              </FormField>
            )}
            {!editing && values.applies !== 'general' && (
              <FormField
                label={values.applies === 'contract' ? t('fields.contract') : t('fields.property')}
                error={errors.targetId}
                required
              >
                {(c) => (
                  <Select {...c} value={values.targetId} onChange={(e) => set('targetId', e.target.value)}>
                    <option value="">{t('chooseTarget')}</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
            <FormField label={t('fields.validFrom')} error={errors.validFrom}>
              {(c) => <Input {...c} type="date" value={values.validFrom} onChange={(e) => set('validFrom', e.target.value)} />}
            </FormField>
            <FormField label={t('fields.validTo')} error={errors.validTo}>
              {(c) => <Input {...c} type="date" value={values.validTo} onChange={(e) => set('validTo', e.target.value)} />}
            </FormField>
          </div>
          <FormField label={t('fields.documentUrl')} error={errors.documentUrl}>
            {(c) => (
              <Input
                {...c}
                type="url"
                placeholder="https://"
                value={values.documentUrl}
                onChange={(e) => set('documentUrl', e.target.value)}
              />
            )}
          </FormField>
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

function PersonLink({ person }: { person?: PartyPerson }) {
  if (!person) return <span>—</span>;
  return (
    <Link href={`/persons/${person.id}`} className="font-medium text-brand-600 hover:text-brand-700">
      {personName(person)}
    </Link>
  );
}

/** Poderes de una persona: los que otorgó (se editan y se revocan) y los que ejerce como apoderada (solo lectura). */
export function PersonPowers({ personId, canEdit }: { personId: string; canEdit: boolean }) {
  const t = useTranslations('parties.powers');
  const tScope = useTranslations('parties.scopes');
  const tMode = useTranslations('parties.signatureModes');
  const confirm = useConfirm();
  const [granted, setGranted] = useState<PowerOfAttorney[] | null>(null);
  const [held, setHeld] = useState<PowerOfAttorney[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<{ power: PowerOfAttorney | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, h] = await Promise.all([
        apiClient<PowerOfAttorney[]>(`/persons/${personId}/powers`),
        apiClient<PowerOfAttorney[]>(`/persons/${personId}/powers?as=agent`),
      ]);
      setGranted(Array.isArray(g) ? g : []);
      setHeld(Array.isArray(h) ? h : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(power: PowerOfAttorney) {
    const ok = await confirm({
      title: t('revokeTitle'),
      body: t('revokeBody', { name: power.agent ? personName(power.agent) : '' }),
      confirmLabel: t('revoke'),
      tone: 'danger',
    });
    if (!ok) return;
    setActionError(null);
    try {
      await apiClient(`/persons/${personId}/powers/${power.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setActionError(err);
    }
  }

  const appliesLabel = (p: PowerOfAttorney) =>
    p.contractId ? t('appliesContract') : p.propertyId ? t('appliesProperty') : t('appliesGeneral');

  const common = (who: 'agent' | 'principal'): DataTableColumn<PowerOfAttorney>[] => [
    {
      key: who,
      header: who === 'agent' ? t('columns.agent') : t('columns.principal'),
      render: (p) => <PersonLink person={who === 'agent' ? p.agent : p.principal} />,
    },
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
    { key: 'applies', header: t('columns.applies'), render: appliesLabel },
    {
      key: 'validity',
      header: t('columns.validity'),
      render: (p) => (
        <span className="flex flex-wrap items-center gap-1 whitespace-nowrap">
          <DateText value={p.validFrom} /> – {p.validTo ? <DateText value={p.validTo} /> : t('openEnded')}
          {!isCurrent(p) && <Badge variant="neutral">{t('notCurrent')}</Badge>}
        </span>
      ),
    },
    {
      key: 'document',
      header: t('columns.document'),
      render: (p) =>
        p.documentUrl ? (
          <a href={p.documentUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700">
            {t('viewDocument')}
          </a>
        ) : (
          '—'
        ),
    },
  ];

  const grantedColumns: DataTableColumn<PowerOfAttorney>[] = [
    ...common('agent'),
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('actions'),
            render: (p: PowerOfAttorney) => (
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setDialog({ power: p })} aria-label={t('editFor', { name: p.agent ? personName(p.agent) : '' })}>
                  {t('edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void revoke(p)} aria-label={t('revokeFor', { name: p.agent ? personName(p.agent) : '' })}>
                  {t('revoke')}
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<PowerOfAttorney>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="person-powers-granted">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="person-powers-granted" className="text-base font-semibold text-slate-900">
            {t('grantedTitle')}
          </h3>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => setDialog({ power: null })}>
              {t('add')}
            </Button>
          )}
        </div>
        {actionError != null && <ErrorNotice error={actionError} className="mb-3" />}
        <DataTable
          columns={grantedColumns}
          items={granted ?? []}
          keyExtractor={(p) => p.id}
          loading={granted === null && loadError == null}
          error={loadError}
          empty={{ title: t('grantedEmpty'), iconName: 'contracts' }}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="person-powers-held">
        <h3 id="person-powers-held" className="mb-3 text-base font-semibold text-slate-900">
          {t('heldTitle')}
        </h3>
        {loadError == null && (
          <DataTable
            columns={common('principal')}
            items={held ?? []}
            keyExtractor={(p) => p.id}
            loading={held === null}
            empty={{ title: t('heldEmpty'), iconName: 'contracts' }}
          />
        )}
      </section>

      {dialog && (
        <PowerDialog principalId={personId} power={dialog.power} onClose={() => setDialog(null)} onSaved={() => void load()} />
      )}
    </div>
  );
}
