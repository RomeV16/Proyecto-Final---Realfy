'use client';

import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/ui/form-shell';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import {
  PropertyType,
  PropertyOperationType,
  PropertyState,
  Currency,
  Province,
  getValidTransitions,
} from '@realfy/shared';
import { propertyFormSchema } from '@realfy/shared/schemas';
import { useState } from 'react';
import { PropertyStateBadge } from './property-state-badge';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { formatMoney, formatLocalDate } from '@/lib/format';

/* ──────────── Types ──────────── */

interface PropertyOperation {
  id: string;
  operationType: string;
  state: string;
  price?: string | number;
  currency?: string;
}

interface PropertyMedia {
  id: string;
  url: string;
  thumbnailUrl?: string;
  isPrimary: boolean;
  sortOrder: number;
}

interface PriceHistoryEntry {
  id: string;
  price: string;
  currency: string;
  changedAt: string;
}

export interface PropertyData {
  id?: string;
  title: string;
  description: string;
  type: string;
  street: string;
  number: string;
  floor: string;
  apartment: string;
  city: string;
  province: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
  totalArea: string;
  rooms: string;
  bedrooms: string;
  bathrooms: string;
  garages: string;
  age: string;
  orientation: string;
  price: string;
  currency: string;
  amenities: string[];
  operations?: PropertyOperation[];
  media?: PropertyMedia[];
  priceHistory?: PriceHistoryEntry[];
  // create-mode only: initial operation
  initialOpType?: string;
  initialOpState?: string;
}

const EMPTY_PROPERTY: PropertyData = {
  title: '',
  description: '',
  type: '',
  street: '',
  number: '',
  floor: '',
  apartment: '',
  city: '',
  province: '',
  postalCode: '',
  totalArea: '',
  rooms: '',
  bedrooms: '',
  bathrooms: '',
  garages: '',
  age: '',
  orientation: '',
  price: '',
  currency: 'USD',
  amenities: [],
  initialOpType: '',
  initialOpState: 'Disponible',
};

const AMENITY_OPTIONS = [
  'Pileta', 'Cochera', 'Balcon', 'Ascensor', 'Seguridad', 'Gimnasio',
  'SUM', 'Terraza', 'Jardin', 'Laundry', 'AC', 'Calefaccion',
] as const;

type StringField = { [K in keyof PropertyData]-?: NonNullable<PropertyData[K]> extends string ? K : never }[keyof PropertyData];

/* ──────────── Main Component ──────────── */

interface PropertyFormProps {
  mode: 'create' | 'edit';
  initialData?: PropertyData;
  propertyId?: string;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}

export function PropertyForm({
  mode,
  initialData,
  propertyId,
  onSuccess,
  onCancel,
}: PropertyFormProps) {
  const t = useTranslations('properties');
  const tForm = useTranslations('properties.form');
  const tCommon = useTranslations('common');

  const { values: form, set, setValues, errors, formError, setFormError, submitting, submit } = useZodForm({
    schema: propertyFormSchema,
    initialValues: initialData || EMPTY_PROPERTY,
    translate: useSchemaMessages(),
  });
  const [newOpType, setNewOpType] = useState('');
  const [addingOp, setAddingOp] = useState(false);
  const [transitionLoading, setTransitionLoading] = useState<string | null>(null);

  function toggleAmenity(amenity: string) {
    set(
      'amenities',
      form.amenities.includes(amenity)
        ? form.amenities.filter((a) => a !== amenity)
        : [...form.amenities, amenity],
    );
  }

  const handleSubmit = submit(async () => {
    const body: Record<string, unknown> = {
      title: form.title,
      description: form.description || undefined,
      type: form.type,
      street: form.street || undefined,
      number: form.number || undefined,
      floor: form.floor || undefined,
      apartment: form.apartment || undefined,
      city: form.city || undefined,
      province: form.province || undefined,
      postalCode: form.postalCode || undefined,
      latitude: form.latitude ?? undefined,
      longitude: form.longitude ?? undefined,
      area: form.totalArea ? Number(form.totalArea) : undefined,
      rooms: form.rooms ? Number(form.rooms) : undefined,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
      garages: form.garages ? Number(form.garages) : undefined,
      age: form.age ? Number(form.age) : undefined,
      orientation: form.orientation || undefined,
      price: form.price ? Number(form.price) : undefined,
      currency: form.currency || undefined,
      amenities: form.amenities.length > 0 ? form.amenities : undefined,
    };

    // Remove undefined values
    Object.keys(body).forEach((k) => {
      if (body[k] === undefined) delete body[k];
    });

    if (mode === 'create') {
      const res = await apiClient<{ id: string }>('/properties', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      // Create initial operation if selected
      if (form.initialOpType) {
        await apiClient(`/properties/${res.id}/operations`, {
          method: 'POST',
          body: JSON.stringify({
            operationType: form.initialOpType,
            state: form.initialOpState || 'Disponible',
          }),
        });
      }
      onSuccess?.(res.id);
    } else {
      await apiClient(`/properties/${propertyId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSuccess?.(propertyId!);
    }
  });

  async function handleAddOperation() {
    if (!newOpType || !propertyId) return;
    setAddingOp(true);
    try {
      const res = await apiClient<PropertyOperation>(`/properties/${propertyId}/operations`, {
        method: 'POST',
        body: JSON.stringify({ operationType: newOpType }),
      });
      setValues((prev) => ({ operations: [...(prev.operations || []), res] }));
      setNewOpType('');
    } catch (err) {
      if (err instanceof ApiRequestError) setFormError(err);
    } finally {
      setAddingOp(false);
    }
  }

  async function handleTransition(opId: string, toState: string) {
    if (!propertyId) return;
    setTransitionLoading(opId);
    try {
      await apiClient(`/properties/${propertyId}/operations/${opId}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ state: toState }),
      });
      // Update local state
      setValues((prev) => ({
        operations: prev.operations?.map((op) =>
          op.id === opId ? { ...op, state: toState } : op
        ),
      }));
    } catch (err) {
      if (err instanceof ApiRequestError) setFormError(err);
    } finally {
      setTransitionLoading(null);
    }
  }

  const existingOpTypes = (form.operations || []).map((op) => op.operationType);
  const availableOpTypes = Object.values(PropertyOperationType).filter(
    (ot) => !existingOpTypes.includes(ot)
  );

  /** Campo de texto del formulario: etiqueta, error y valor enlazados al estado. */
  function textField(
    field: StringField,
    label: string,
    options: { placeholder?: string; type?: string; required?: boolean; className?: string } = {},
  ) {
    return (
      <FormField label={label} required={options.required} error={errors[field]} className={options.className}>
        {(c) => (
          <Input
            {...c}
            type={options.type}
            value={String(form[field] ?? '')}
            onChange={(e) => set(field, e.target.value)}
            placeholder={options.placeholder}
          />
        )}
      </FormField>
    );
  }

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel={submitting ? (mode === 'create' ? tForm('creating') : tForm('updating')) : tForm('submit')}
      submitBusy={submitting}
      secondaryAction={onCancel ? { label: tCommon('cancel'), onClick: onCancel } : undefined}
    >
      {/* Error banner */}
      {formError != null && <ErrorNotice error={formError} fallback={tForm('error')} />}

      {/* Basic Info */}
      <FormShell.Section title={tForm('basicInfo')} className="max-w-sm sm:max-w-none">
        <div className="space-y-4">
          {textField('title', tForm('titleField'), { placeholder: tForm('titlePlaceholder'), required: true })}
          <FormField label={tForm('description')} error={errors.description}>
            {(c) => (
              <Textarea
                {...c}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={tForm('descriptionPlaceholder')}
              />
            )}
          </FormField>
          <FormField label={tForm('type')} required error={errors.type}>
            {(c) => (
              <Select {...c} value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="">{tForm('typePlaceholder')}</option>
                {Object.values(PropertyType).map((pt) => (
                  <option key={pt} value={pt}>{t(`types.${pt}`)}</option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
      </FormShell.Section>

      {/* Address */}
      <FormShell.Section title={tForm('address')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {textField('street', tForm('street'), { placeholder: tForm('streetPlaceholder'), className: 'sm:col-span-2' })}
          {textField('number', tForm('number'), { placeholder: tForm('numberPlaceholder') })}
          <div className="grid grid-cols-2 gap-3">
            {textField('floor', tForm('floor'), { placeholder: tForm('floorPlaceholder') })}
            {textField('apartment', tForm('apartment'), { placeholder: tForm('apartmentPlaceholder') })}
          </div>
          {textField('city', tForm('city'), { placeholder: tForm('cityPlaceholder') })}
          <FormField label={tForm('province')} error={errors.province}>
            {(c) => (
              <Select {...c} value={form.province} onChange={(e) => set('province', e.target.value)}>
                <option value="">{tForm('provincePlaceholder')}</option>
                {Object.values(Province).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            )}
          </FormField>
          {textField('postalCode', tForm('postalCode'), { placeholder: tForm('postalCodePlaceholder') })}
        </div>
      </FormShell.Section>

      {/* Characteristics */}
      <FormShell.Section title={tForm('characteristics')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <FormField label={tForm('totalArea')} error={errors.totalArea}>
            {(c) => (
              <div className="relative">
                <Input
                  {...c}
                  type="number"
                  value={form.totalArea}
                  onChange={(e) => set('totalArea', e.target.value)}
                />
                <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)]">
                  m²
                </span>
              </div>
            )}
          </FormField>
          {textField('rooms', tForm('rooms'), { type: 'number' })}
          {textField('bedrooms', tForm('bedrooms'), { type: 'number' })}
          {textField('bathrooms', tForm('bathrooms'), { type: 'number' })}
          {textField('garages', tForm('garages'), { type: 'number' })}
          {textField('age', tForm('age'), { type: 'number' })}
          {textField('orientation', tForm('orientation'), { placeholder: tForm('orientationPlaceholder') })}
        </div>
      </FormShell.Section>

      {/* Initial Operation — only in create mode */}
      {mode === 'create' && (
        <FormShell.Section title={tForm('operations')} className="max-w-sm sm:max-w-none">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={tForm('operationType')}>
              {(c) => (
                <Select {...c} value={form.initialOpType || ''} onChange={(e) => set('initialOpType', e.target.value)}>
                  <option value="">{tForm('operationTypePlaceholder')}</option>
                  {Object.values(PropertyOperationType).map((ot) => (
                    <option key={ot} value={ot}>{t(`operationTypes.${ot}`)}</option>
                  ))}
                </Select>
              )}
            </FormField>
            {form.initialOpType && (
              <FormField label={tForm('state')}>
                {(c) => (
                  <Select
                    {...c}
                    value={form.initialOpState || 'Disponible'}
                    onChange={(e) => set('initialOpState', e.target.value)}
                  >
                    {Object.values(PropertyState).map((s) => (
                      <option key={s} value={s}>{t(`states.${s}`)}</option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
          </div>
        </FormShell.Section>
      )}

      {/* Operations — only in edit mode */}
      {mode === 'edit' && (
        <FormShell.Section title={tForm('operations')} className="max-w-sm sm:max-w-none">

          {(form.operations || []).length === 0 ? (
            <p className="text-sm text-slate-400">{tForm('noOperations')}</p>
          ) : (
            <div className="space-y-3 mb-4">
              {(form.operations || []).map((op) => {
                const validNext = getValidTransitions(
                  op.operationType as PropertyOperationType,
                  op.state as PropertyState,
                );
                return (
                  <div key={op.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-medium text-slate-900">
                        {t(`operationTypes.${op.operationType}`)}
                      </span>
                      <PropertyStateBadge state={op.state} />
                      {op.price && (
                        <span className="text-sm text-slate-600 tabular-nums">
                          {formatMoney(op.price, op.currency)}
                        </span>
                      )}
                    </div>
                    {validNext.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-slate-500">{t('detail.transitionTo')}:</span>
                        {validNext.map((next) => (
                          <button
                            key={next}
                            type="button"
                            disabled={transitionLoading === op.id}
                            onClick={() => handleTransition(op.id, next)}
                            className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 text-slate-700 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 transition-colors disabled:opacity-50"
                          >
                            {t(`states.${next}`)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add operation */}
          {availableOpTypes.length > 0 && (
            <div className="flex items-end gap-3 pt-2 border-t border-slate-100">
              <FormField label={tForm('operationType')} className="flex-1">
                {(c) => (
                  <Select {...c} value={newOpType} onChange={(e) => setNewOpType(e.target.value)}>
                    <option value="">{tForm('operationTypePlaceholder')}</option>
                    {availableOpTypes.map((ot) => (
                      <option key={ot} value={ot}>{t(`operationTypes.${ot}`)}</option>
                    ))}
                  </Select>
                )}
              </FormField>
              <button
                type="button"
                disabled={!newOpType || addingOp}
                onClick={handleAddOperation}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tForm('addOperation')}
              </button>
            </div>
          )}
        </FormShell.Section>
      )}

      {/* Pricing */}
      <FormShell.Section title={tForm('pricing')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {textField('price', tForm('price'), { placeholder: tForm('pricePlaceholder'), type: 'number' })}
          <FormField label={tForm('currency')} error={errors.currency}>
            {(c) => (
              <Select {...c} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {Object.values(Currency).map((cur) => (
                  <option key={cur} value={cur}>{cur === 'USD' ? 'US$ (Dólar)' : '$ (Peso argentino)'}</option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
      </FormShell.Section>

      {/* Price History — read-only in edit mode */}
      {mode === 'edit' && (form.priceHistory || []).length > 0 && (
        <FormShell.Section title={t('detail.priceHistory')} className="max-w-sm sm:max-w-none">

          <div className="space-y-2">
            {(form.priceHistory || []).map((ph) => (
              <div key={ph.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-50 last:border-0">
                <span className="font-medium text-slate-900 tabular-nums">
                  {formatMoney(ph.price, ph.currency)}
                </span>
                <span className="text-xs text-slate-500">
                  {formatLocalDate(ph.changedAt, 'numeric')}
                </span>
              </div>
            ))}
          </div>
        </FormShell.Section>
      )}

      {/* Amenities */}
      <FormShell.Section title={tForm('amenities')} className="max-w-sm sm:max-w-none">
        <div className="flex flex-wrap gap-2">
          {AMENITY_OPTIONS.map((amenity) => {
            const isSelected = form.amenities.includes(amenity);
            return (
              <button
                key={amenity}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleAmenity(amenity)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isSelected
                    ? 'bg-brand-50 text-brand-700 border-brand-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {t(`amenities.${amenity}`)}
              </button>
            );
          })}
        </div>
      </FormShell.Section>

    </FormShell>
  );
}
