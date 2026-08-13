'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  PropertyOperationType,
  PropertyState,
  getValidTransitions,
} from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { PropertyForm, type PropertyData } from '@/components/properties/property-form';
import { PropertyStateBadge } from '@/components/properties/property-state-badge';
import { PropertyTypeBadge } from '@/components/properties/property-type-badge';
import { PropertyMediaUpload } from '@/components/properties/property-media-upload';
import { PriceHistory } from '@/components/properties/price-history';
import { PersonRoleBadge } from '@/components/persons/person-role-badge';
import { EntityRow } from '@/components/ui/entity-card';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';

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

interface PropertyDetail {
  id: string;
  title: string;
  description?: string;
  type: string;
  street?: string;
  number?: string;
  floor?: string;
  apartment?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  area?: number;
  rooms?: number;
  bedrooms?: number;
  bathrooms?: number;
  garages?: number;
  age?: number;
  orientation?: string;
  price?: string | number;
  currency?: string;
  amenities?: string[];
  isActive: boolean;
  operations: PropertyOperation[];
  media: PropertyMedia[];
  priceHistory: PriceHistoryEntry[];
  personRoles?: PropertyPersonRole[];
  createdAt: string;
  updatedAt: string;
}

interface PropertyPersonRole {
  id: string;
  role: string;
  guarantorForPersonId?: string | null;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
  };
}

/* ──────────── Helpers ──────────── */

function toFormData(detail: PropertyDetail): PropertyData {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description || '',
    type: detail.type,
    street: detail.street || '',
    number: detail.number || '',
    floor: detail.floor || '',
    apartment: detail.apartment || '',
    city: detail.city || '',
    province: detail.province || '',
    postalCode: detail.postalCode || '',
    latitude: detail.latitude ?? undefined,
    longitude: detail.longitude ?? undefined,
    totalArea: detail.area?.toString() || '',
    rooms: detail.rooms?.toString() || '',
    bedrooms: detail.bedrooms?.toString() || '',
    bathrooms: detail.bathrooms?.toString() || '',
    garages: detail.garages?.toString() || '',
    age: detail.age?.toString() || '',
    orientation: detail.orientation || '',
    price: detail.price?.toString() || '',
    currency: detail.currency || 'USD',
    amenities: detail.amenities || [],
    operations: detail.operations || [],
    media: detail.media || [],
    priceHistory: detail.priceHistory || [],
  };
}

/* ──────────── Detail View ──────────── */

const ROLE_ORDER = [
  'Propietario',
  'Inquilino',
  'Comprador',
  'Garante',
  'Lead',
  'Proveedor',
];

function DetailView({
  property,
  onEdit,
  onDelete,
  onRefresh,
  canEdit,
  canDelete,
}: {
  property: PropertyDetail;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('properties');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const localePrefix =
    pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const [transitionLoading, setTransitionLoading] = useState<string | null>(null);
  const [operations, setOperations] = useState(property.operations || []);
  const [mediaItems, setMediaItems] = useState(property.media || []);
  const [error, setError] = useState('');

  async function handleTransition(opId: string, toState: string) {
    setTransitionLoading(opId);
    setError('');
    try {
      await apiClient(`/properties/${property.id}/operations/${opId}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ state: toState }),
      });
      setOperations((prev) =>
        prev.map((op) => (op.id === opId ? { ...op, state: toState } : op))
      );
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError(t('detail.transitionError'));
      }
    } finally {
      setTransitionLoading(null);
    }
  }

  const address = [
    property.street,
    property.number && `Nº ${property.number}`,
    property.floor && `Piso ${property.floor}`,
    property.apartment && `Depto. ${property.apartment}`,
  ].filter(Boolean).join(', ');
  const location = [property.city, property.province].filter(Boolean).join(', ');

  return (
    <div className="space-y-6 w-full max-w-2xl">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <PropertyTypeBadge type={property.type} />
              {property.price && (
                <span className="text-lg font-bold text-slate-900 tabular-nums">
                  {property.currency === 'USD' ? 'US$' : '$'}{' '}
                  {Number(property.price).toLocaleString('es-AR')}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900">{property.title}</h2>
            {address && <p className="text-sm text-slate-600">{address}</p>}
            {location && <p className="text-sm text-slate-500">{location} {property.postalCode && `(${property.postalCode})`}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            {canEdit && (
              <button
                onClick={onEdit}
                className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
              >
                {t('detail.edit')}
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDelete}
                className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
              >
                {tCommon('delete')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {property.description && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{property.description}</p>
        </div>
      )}

      {/* Characteristics */}
      {(property.area || property.rooms || property.bedrooms || property.bathrooms || property.garages) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-3">{t('form.characteristics')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {property.area != null && (
              <div>
                <p className="text-xs text-slate-500">{t('form.totalArea')}</p>
                <p className="text-sm font-medium text-slate-900 tabular-nums">{property.area} m²</p>
              </div>
            )}
            {property.rooms != null && (
              <div>
                <p className="text-xs text-slate-500">{t('form.rooms')}</p>
                <p className="text-sm font-medium text-slate-900">{property.rooms}</p>
              </div>
            )}
            {property.bedrooms != null && (
              <div>
                <p className="text-xs text-slate-500">{t('form.bedrooms')}</p>
                <p className="text-sm font-medium text-slate-900">{property.bedrooms}</p>
              </div>
            )}
            {property.bathrooms != null && (
              <div>
                <p className="text-xs text-slate-500">{t('form.bathrooms')}</p>
                <p className="text-sm font-medium text-slate-900">{property.bathrooms}</p>
              </div>
            )}
            {property.garages != null && (
              <div>
                <p className="text-xs text-slate-500">{t('form.garages')}</p>
                <p className="text-sm font-medium text-slate-900">{property.garages}</p>
              </div>
            )}
            {property.age != null && (
              <div>
                <p className="text-xs text-slate-500">{t('form.age')}</p>
                <p className="text-sm font-medium text-slate-900">{property.age}</p>
              </div>
            )}
            {property.orientation && (
              <div>
                <p className="text-xs text-slate-500">{t('form.orientation')}</p>
                <p className="text-sm font-medium text-slate-900">{property.orientation}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Media Upload / Gallery */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-3">{t('media.title')}</h3>
        <PropertyMediaUpload
          propertyId={property.id}
          media={mediaItems}
          onMediaChange={setMediaItems}
          readOnly={!canEdit}
        />
      </div>

      {/* Linked persons — owner / tenant / guarantor */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-3">
          {t('detail.linkedPersons')}
        </h3>
        {(property.personRoles || []).length === 0 ? (
          <p className="text-sm text-slate-400">{t('detail.noLinkedPersons')}</p>
        ) : (
          <div className="space-y-2">
            {[...(property.personRoles || [])]
              .sort(
                (a, b) =>
                  ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
              )
              .map((pr) => {
                const fullName = `${pr.person.firstName} ${pr.person.lastName}`;
                const href = `${localePrefix}/persons/${pr.person.id}`;
                return (
                  <EntityRow
                    key={pr.id}
                    href={href}
                    label={fullName}
                    leading={<Avatar name={fullName} seed={pr.person.id} size="md" />}
                    title={fullName}
                    meta={
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PersonRoleBadge role={pr.role} />
                      </div>
                    }
                    trailing={
                      <div className="flex flex-col items-end gap-0.5 text-xs text-[var(--color-muted)]">
                        {pr.person.phone && <span>{pr.person.phone}</span>}
                        {pr.person.email && <span>{pr.person.email}</span>}
                      </div>
                    }
                    actions={
                      <EntityRow.Action href={href} icon="arrowRight" variant="ghost">
                        {t('card.view')}
                      </EntityRow.Action>
                    }
                  />
                );
              })}
          </div>
        )}
      </div>

      {/* Operations */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-3">{t('detail.operations')}</h3>
        {operations.length === 0 ? (
          <p className="text-sm text-slate-400">{t('form.noOperations')}</p>
        ) : (
          <div className="space-y-3">
            {operations.map((op) => {
              const validNext = getValidTransitions(
                op.operationType as PropertyOperationType,
                op.state as PropertyState,
              );
              return (
                <EntityRow
                  key={op.id}
                  accent="brand"
                  leading={
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full"
                      style={{
                        backgroundColor:
                          'color-mix(in oklab, var(--color-brand-500) 14%, var(--color-surface))',
                        color: 'var(--color-brand-500)',
                      }}
                    >
                      <Icon name="properties" className="h-5 w-5" strokeWidth={1.9} />
                    </span>
                  }
                  title={t(`operationTypes.${op.operationType}`)}
                  meta={
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PropertyStateBadge state={op.state} />
                    </div>
                  }
                  trailing={
                    op.price ? (
                      <EntityRow.Amount
                        value={`${op.currency === 'USD' ? 'US$' : '$'} ${Number(op.price).toLocaleString('es-AR')}`}
                      />
                    ) : (
                      <EntityRow.Amount value={t('card.noPrice')} tone="muted" />
                    )
                  }
                  actions={
                    canEdit && validNext.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="hidden text-xs text-[var(--color-muted)] lg:inline">
                          {t('detail.transitionTo')}:
                        </span>
                        {validNext.map((next) => (
                          <EntityRow.Action
                            key={next}
                            variant="ghost"
                            disabled={transitionLoading === op.id}
                            onClick={() => handleTransition(op.id, next)}
                          >
                            {t(`states.${next}`)}
                          </EntityRow.Action>
                        ))}
                      </div>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Price History */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-3">{t('priceHistory.title')}</h3>
        <PriceHistory entries={property.priceHistory || []} />
      </div>

      {/* Amenities */}
      {(property.amenities || []).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-3">{t('form.amenities')}</h3>
          <div className="flex flex-wrap gap-2">
            {(property.amenities || []).map((a) => (
              <span
                key={a}
                className="px-3 py-1.5 rounded-full text-sm font-medium bg-brand-50 text-brand-700 border border-brand-200"
              >
                {t(`amenities.${a}`)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────── Main Page ──────────── */

export default function PropertyDetailPage() {
  const t = useTranslations('properties');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const propertyId = params.id as string;

  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const canEdit = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');
  const canDelete = ['Admin', 'Gerente'].includes(user?.role || '');

  const loadProperty = useCallback(async () => {
    try {
      const data = await apiClient<PropertyDetail>(`/properties/${propertyId}`);
      setProperty(data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  async function handleDelete() {
    try {
      await apiClient(`/properties/${propertyId}`, { method: 'DELETE' });
      router.push(`${localePrefix}/properties`);
    } catch {
      // stay on page
    }
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Not found
  if (notFound || !property) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{t('empty.detail')}</h2>
        <Link
          href={`${localePrefix}/properties`}
          className="mt-4 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {t('backToList')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/properties`}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label={t('backToList')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {editing ? t('editTitle') : t('detailTitle')}
        </h1>
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <p className="text-sm text-red-700 flex-1">{t('detail.deleteConfirm')}</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              {tCommon('confirm')}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {tCommon('cancel')}
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <PropertyForm
          mode="edit"
          propertyId={property.id}
          initialData={toFormData(property)}
          onSuccess={() => {
            setEditing(false);
            loadProperty();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <DetailView
          property={property}
          onEdit={() => setEditing(true)}
          onDelete={() => setDeleteConfirm(true)}
          onRefresh={loadProperty}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}
