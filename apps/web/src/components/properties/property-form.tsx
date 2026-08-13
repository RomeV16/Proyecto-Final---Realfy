'use client';

import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/ui/form-shell';
import {
  PropertyType,
  PropertyOperationType,
  PropertyState,
  Currency,
  Province,
  getValidTransitions,
} from '@realfy/shared';
import { propertyFormSchema } from '@realfy/shared/schemas';
import { useState, type FormEvent } from 'react';
import { PropertyStateBadge } from './property-state-badge';
import { apiClient, ApiRequestError } from '@/lib/api-client';

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

/* ──────────── Helpers ──────────── */


function InputLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 mb-1.5">
      {children}
    </label>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  suffix,
  required,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  suffix?: string;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

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

  const [form, setForm] = useState<PropertyData>(initialData || EMPTY_PROPERTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [newOpType, setNewOpType] = useState('');
  const [addingOp, setAddingOp] = useState(false);
  const [transitionLoading, setTransitionLoading] = useState<string | null>(null);

  function updateField(field: keyof PropertyData, value: string | string[]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleAmenity(amenity: string) {
    setForm((prev) => {
      const amenities = prev.amenities.includes(amenity)
        ? prev.amenities.filter((a) => a !== amenity)
        : [...prev.amenities, amenity];
      return { ...prev, amenities };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

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

    try {
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
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError(tForm('error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddOperation() {
    if (!newOpType || !propertyId) return;
    setAddingOp(true);
    try {
      const res = await apiClient<PropertyOperation>(`/properties/${propertyId}/operations`, {
        method: 'POST',
        body: JSON.stringify({ operationType: newOpType }),
      });
      setForm((prev) => ({
        ...prev,
        operations: [...(prev.operations || []), res],
      }));
      setNewOpType('');
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
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
      setForm((prev) => ({
        ...prev,
        operations: prev.operations?.map((op) =>
          op.id === opId ? { ...op, state: toState } : op
        ),
      }));
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
    } finally {
      setTransitionLoading(null);
    }
  }

  const existingOpTypes = (form.operations || []).map((op) => op.operationType);
  const availableOpTypes = Object.values(PropertyOperationType).filter(
    (ot) => !existingOpTypes.includes(ot)
  );

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel={submitting ? (mode === 'create' ? tForm('creating') : tForm('updating')) : tForm('submit')}
      submitBusy={submitting}
      secondaryAction={onCancel ? { label: tCommon('cancel'), onClick: onCancel } : undefined}
    >
      {/* Error banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Basic Info */}
      <FormShell.Section title={tForm('basicInfo')} className="max-w-sm sm:max-w-none">
        <div className="space-y-4">
          <div>
            <InputLabel htmlFor="title">{tForm('titleField')}</InputLabel>
            <TextInput
              id="title"
              value={form.title}
              onChange={(v) => updateField('title', v)}
              placeholder={tForm('titlePlaceholder')}
              required
            />
          </div>
          <div>
            <InputLabel htmlFor="description">{tForm('description')}</InputLabel>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder={tForm('descriptionPlaceholder')}
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
            />
          </div>
          <div>
            <InputLabel htmlFor="type">{tForm('type')}</InputLabel>
            <select
              id="type"
              value={form.type}
              onChange={(e) => updateField('type', e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tForm('typePlaceholder')}</option>
              {Object.values(PropertyType).map((pt) => (
                <option key={pt} value={pt}>{t(`types.${pt}`)}</option>
              ))}
            </select>
          </div>
        </div>
      </FormShell.Section>

      {/* Address */}
      <FormShell.Section title={tForm('address')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <InputLabel htmlFor="street">{tForm('street')}</InputLabel>
            <TextInput
              id="street"
              value={form.street}
              onChange={(v) => updateField('street', v)}
              placeholder={tForm('streetPlaceholder')}
            />
          </div>
          <div>
            <InputLabel htmlFor="number">{tForm('number')}</InputLabel>
            <TextInput
              id="number"
              value={form.number}
              onChange={(v) => updateField('number', v)}
              placeholder={tForm('numberPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <InputLabel htmlFor="floor">{tForm('floor')}</InputLabel>
              <TextInput
                id="floor"
                value={form.floor}
                onChange={(v) => updateField('floor', v)}
                placeholder={tForm('floorPlaceholder')}
              />
            </div>
            <div>
              <InputLabel htmlFor="apartment">{tForm('apartment')}</InputLabel>
              <TextInput
                id="apartment"
                value={form.apartment}
                onChange={(v) => updateField('apartment', v)}
                placeholder={tForm('apartmentPlaceholder')}
              />
            </div>
          </div>
          <div>
            <InputLabel htmlFor="city">{tForm('city')}</InputLabel>
            <TextInput
              id="city"
              value={form.city}
              onChange={(v) => updateField('city', v)}
              placeholder={tForm('cityPlaceholder')}
            />
          </div>
          <div>
            <InputLabel htmlFor="province">{tForm('province')}</InputLabel>
            <select
              id="province"
              value={form.province}
              onChange={(e) => updateField('province', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tForm('provincePlaceholder')}</option>
              {Object.values(Province).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <InputLabel htmlFor="postalCode">{tForm('postalCode')}</InputLabel>
            <TextInput
              id="postalCode"
              value={form.postalCode}
              onChange={(v) => updateField('postalCode', v)}
              placeholder={tForm('postalCodePlaceholder')}
            />
          </div>
        </div>
      </FormShell.Section>

      {/* Characteristics */}
      <FormShell.Section title={tForm('characteristics')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <InputLabel htmlFor="totalArea">{tForm('totalArea')}</InputLabel>
            <TextInput
              id="totalArea"
              value={form.totalArea}
              onChange={(v) => updateField('totalArea', v)}
              type="number"
              suffix="m²"
            />
          </div>
          <div>
            <InputLabel htmlFor="rooms">{tForm('rooms')}</InputLabel>
            <TextInput
              id="rooms"
              value={form.rooms}
              onChange={(v) => updateField('rooms', v)}
              type="number"
            />
          </div>
          <div>
            <InputLabel htmlFor="bedrooms">{tForm('bedrooms')}</InputLabel>
            <TextInput
              id="bedrooms"
              value={form.bedrooms}
              onChange={(v) => updateField('bedrooms', v)}
              type="number"
            />
          </div>
          <div>
            <InputLabel htmlFor="bathrooms">{tForm('bathrooms')}</InputLabel>
            <TextInput
              id="bathrooms"
              value={form.bathrooms}
              onChange={(v) => updateField('bathrooms', v)}
              type="number"
            />
          </div>
          <div>
            <InputLabel htmlFor="garages">{tForm('garages')}</InputLabel>
            <TextInput
              id="garages"
              value={form.garages}
              onChange={(v) => updateField('garages', v)}
              type="number"
            />
          </div>
          <div>
            <InputLabel htmlFor="age">{tForm('age')}</InputLabel>
            <TextInput
              id="age"
              value={form.age}
              onChange={(v) => updateField('age', v)}
              type="number"
            />
          </div>
          <div>
            <InputLabel htmlFor="orientation">{tForm('orientation')}</InputLabel>
            <TextInput
              id="orientation"
              value={form.orientation}
              onChange={(v) => updateField('orientation', v)}
              placeholder={tForm('orientationPlaceholder')}
            />
          </div>
        </div>
      </FormShell.Section>

      {/* Initial Operation — only in create mode */}
      {mode === 'create' && (
        <FormShell.Section title={tForm('operations')} className="max-w-sm sm:max-w-none">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <InputLabel htmlFor="initialOpType">{tForm('operationType')}</InputLabel>
              <select
                id="initialOpType"
                value={form.initialOpType || ''}
                onChange={(e) => updateField('initialOpType', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                <option value="">{tForm('operationTypePlaceholder')}</option>
                {Object.values(PropertyOperationType).map((ot) => (
                  <option key={ot} value={ot}>{t(`operationTypes.${ot}`)}</option>
                ))}
              </select>
            </div>
            {form.initialOpType && (
              <div>
                <InputLabel htmlFor="initialOpState">{tForm('state')}</InputLabel>
                <select
                  id="initialOpState"
                  value={form.initialOpState || 'Disponible'}
                  onChange={(e) => updateField('initialOpState', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  {Object.values(PropertyState).map((s) => (
                    <option key={s} value={s}>{t(`states.${s}`)}</option>
                  ))}
                </select>
              </div>
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
                          {op.currency === 'USD' ? 'US$' : '$'} {Number(op.price).toLocaleString('es-AR')}
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
              <div className="flex-1">
                <InputLabel htmlFor="newOpType">{tForm('operationType')}</InputLabel>
                <select
                  id="newOpType"
                  value={newOpType}
                  onChange={(e) => setNewOpType(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  <option value="">{tForm('operationTypePlaceholder')}</option>
                  {availableOpTypes.map((ot) => (
                    <option key={ot} value={ot}>{t(`operationTypes.${ot}`)}</option>
                  ))}
                </select>
              </div>
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
          <div>
            <InputLabel htmlFor="price">{tForm('price')}</InputLabel>
            <TextInput
              id="price"
              value={form.price}
              onChange={(v) => updateField('price', v)}
              placeholder={tForm('pricePlaceholder')}
              type="number"
            />
          </div>
          <div>
            <InputLabel htmlFor="currency">{tForm('currency')}</InputLabel>
            <select
              id="currency"
              value={form.currency}
              onChange={(e) => updateField('currency', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              {Object.values(Currency).map((c) => (
                <option key={c} value={c}>{c === 'USD' ? 'US$ (Dólar)' : '$ (Peso argentino)'}</option>
              ))}
            </select>
          </div>
        </div>
      </FormShell.Section>

      {/* Price History — read-only in edit mode */}
      {mode === 'edit' && (form.priceHistory || []).length > 0 && (
        <FormShell.Section title={t('detail.priceHistory')} className="max-w-sm sm:max-w-none">

          <div className="space-y-2">
            {(form.priceHistory || []).map((ph) => (
              <div key={ph.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-50 last:border-0">
                <span className="font-medium text-slate-900 tabular-nums">
                  {ph.currency === 'USD' ? 'US$' : '$'} {Number(ph.price).toLocaleString('es-AR')}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(ph.changedAt).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
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
