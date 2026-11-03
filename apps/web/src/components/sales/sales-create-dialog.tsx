'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { parsePositiveAmount } from '@/lib/cash';
import { CURRENCIES, placeOf } from '@/lib/sales';
import { Button } from '@/components/ui/button';
import { FieldsDialog, type FieldDef } from '@/components/ui/fields-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

interface PropertyRef {
  id: string;
  title: string;
  street?: string | null;
  number?: string | null;
}

interface Props {
  /** Propiedad ya elegida (desde su ficha); sin ella se busca. */
  property?: PropertyRef;
  onClose: () => void;
  onDone: () => void;
}

/** Alta de una operación de venta: la propiedad (buscada o ya elegida), el precio de publicación y si es exclusiva. */
export function SalesCreateDialog({ property: initialProperty, onClose, onDone }: Props) {
  const t = useTranslations('sales');
  const [property, setProperty] = useState<PropertyRef | null>(initialProperty ?? null);

  const fields: FieldDef[] = [
    { name: 'status', label: t('create.status'), kind: 'select', required: true, options: ['Captacion', 'Publicada'].map((s) => ({ value: s, label: t(`statuses.${s}`) })) },
    { name: 'price', label: t('create.price'), kind: 'amount' },
    { name: 'currency', label: t('create.currency'), kind: 'select', required: true, options: CURRENCIES.map((c) => ({ value: c, label: c })) },
    {
      name: 'exclusive',
      label: t('create.exclusive'),
      kind: 'select',
      required: true,
      hint: t('create.exclusiveHint'),
      options: [
        { value: 'false', label: t('create.exclusiveNo') },
        { value: 'true', label: t('create.exclusiveYes') },
      ],
    },
    { name: 'notes', label: t('create.notes'), kind: 'textarea' },
  ];

  return (
    <FieldsDialog
      title={t('create.title')}
      description={t('create.description')}
      fields={fields}
      initial={{ status: 'Captacion', currency: 'USD', exclusive: 'false' }}
      submitLabel={t('create.submit')}
      successMessage={t('create.done')}
      errorFallback={t('create.error')}
      extra={<PropertySearch value={property} onChange={setProperty} />}
      precheck={() => (property ? null : t('create.propertyRequired'))}
      request={(v) =>
        apiClient('/sales-operations', {
          method: 'POST',
          body: JSON.stringify({
            propertyId: property!.id,
            status: v.status,
            price: v.price ? parsePositiveAmount(v.price) : null,
            currency: v.currency,
            exclusive: v.exclusive === 'true',
            notes: v.notes || null,
          }),
        })
      }
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Buscador de propiedad: escribe, elige un resultado y queda fijada hasta que se cambia. */
function PropertySearch({ value, onChange }: { value: PropertyRef | null; onChange: (p: PropertyRef | null) => void }) {
  const t = useTranslations('sales.create');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PropertyRef[] | null>(null);
  const request = useRef(0);

  async function search(text: string) {
    setQuery(text);
    const current = ++request.current;
    if (text.trim().length < 2) {
      setResults(null);
      return;
    }
    try {
      const res = await apiClient<{ items: PropertyRef[] }>(`/properties?search=${encodeURIComponent(text.trim())}&limit=8`);
      if (current === request.current) setResults(res.items ?? []);
    } catch {
      if (current === request.current) setResults([]);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3.5 py-2 text-sm">
        <span className="font-medium text-[var(--color-text)]">{placeOf(value)}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t('changeProperty')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <FormField label={t('property')} hint={t('propertyHint')} required>
        {(c) => <Input {...c} value={query} onChange={(e) => void search(e.target.value)} autoComplete="off" />}
      </FormField>
      {results && results.length === 0 && <p className="mt-1 text-xs text-[var(--color-muted)]">{t('noProperties')}</p>}
      {results && results.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]" aria-label={t('propertyResults')}>
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(p);
                  setQuery('');
                  setResults(null);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-sunken)]"
              >
                {placeOf(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
