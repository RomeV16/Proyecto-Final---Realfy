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
import { PropertyGallery } from '@/components/properties/property-gallery';
import {
  DetailSection,
  ExpandableText,
  FactList,
  SpecGrid,
  type Fact,
  type SpecItem,
} from '@/components/properties/property-detail-sections';
import { PriceHistory } from '@/components/properties/price-history';
import { PersonRoleBadge } from '@/components/persons/person-role-badge';
import { EntityRow } from '@/components/ui/entity-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/* ──────────── Types ──────────── */

interface PropertyOperation {
  id: string;
  operationType: string;
  state: string;
  price?: string | number | null;
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
  /** La API expone el código postal como `zipCode`; el formulario lo llama `postalCode`. */
  zipCode?: string;
  postalCode?: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  /** Superficie en m². */
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

function formatPrice(price: string | number, currency?: string): string {
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${Number(price).toLocaleString('es-AR')}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

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
    postalCode: detail.zipCode || detail.postalCode || '',
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
    // La API deja `price` en null cuando la operación no fija uno propio.
    operations: (detail.operations || []).map((op) => ({ ...op, price: op.price ?? undefined })),
    media: detail.media || [],
    priceHistory: detail.priceHistory || [],
  };
}

/** Calle 1234, Piso 4, Depto. A */
function streetLine(property: PropertyDetail): string {
  return [
    [property.street, property.number].filter(Boolean).join(' '),
    property.floor && `Piso ${property.floor}`,
    property.apartment && `Depto. ${property.apartment}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Ciudad, Provincia (CP) */
function localityLine(property: PropertyDetail): string {
  const zip = property.zipCode || property.postalCode;
  const base = [property.city, property.province].filter(Boolean).join(', ');
  return [base, zip && `(${zip})`].filter(Boolean).join(' ');
}

const ROLE_ORDER = [
  'Propietario',
  'Inquilino',
  'Comprador',
  'Garante',
  'Lead',
  'Proveedor',
];

/* ──────────── Shared button styles ──────────── */

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-medium transition-colors duration-300 [transition-timing-function:var(--ease-luxe)] disabled:cursor-not-allowed disabled:opacity-60';

const BUTTON_PRIMARY = 'bg-[var(--color-brand-500)] text-white shadow-sm hover:bg-[var(--color-brand-600)]';

const BUTTON_GHOST =
  'border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] hover:text-[var(--color-brand-700)]';

const BUTTON_DANGER =
  'border border-[color-mix(in_oklab,var(--color-danger)_30%,var(--color-border))] text-[color-mix(in_oklab,var(--color-danger)_78%,var(--color-text))] hover:bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))]';

/* ──────────── Detail view ──────────── */

function DetailView({
  property,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  property: PropertyDetail;
  onEdit: () => void;
  onDelete: () => void;
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

  /* La operación puede fijar su propio precio; si no lo hace, vale el precio de
     referencia de la ficha. */
  const primaryOp = operations[0];
  const headlinePrice = primaryOp?.price ?? property.price;
  const headlineCurrency = primaryOp?.currency || property.currency || 'ARS';

  const amenities = property.amenities || [];
  const personRoles = [...(property.personRoles || [])].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );

  const specs: SpecItem[] = [];
  if (property.area != null) specs.push({ icon: 'area', label: t('form.totalArea'), value: `${property.area} m²` });
  if (property.rooms != null) specs.push({ icon: 'rooms', label: t('form.rooms'), value: property.rooms });
  if (property.bedrooms != null) specs.push({ icon: 'bedrooms', label: t('form.bedrooms'), value: property.bedrooms });
  if (property.bathrooms != null) specs.push({ icon: 'bathrooms', label: t('form.bathrooms'), value: property.bathrooms });
  if (property.garages != null) specs.push({ icon: 'garages', label: t('form.garages'), value: property.garages });
  if (property.age != null) specs.push({ icon: 'clock', label: t('form.age'), value: property.age });
  if (property.orientation) specs.push({ icon: 'orientation', label: t('form.orientation'), value: property.orientation });

  const street = streetLine(property);
  const locality = localityLine(property);

  const facts: Fact[] = [{ label: t('form.type'), value: t(`types.${property.type}`) }];
  if (street) facts.push({ label: t('form.address'), value: street });
  if (property.city) facts.push({ label: t('form.city'), value: property.city });
  if (property.province) facts.push({ label: t('form.province'), value: property.province });
  if (property.zipCode || property.postalCode) {
    facts.push({ label: t('form.postalCode'), value: property.zipCode || property.postalCode });
  }
  if (property.country) facts.push({ label: t('detail.country'), value: property.country });
  if (property.latitude != null && property.longitude != null) {
    facts.push({
      label: t('map.coordinates'),
      value: `${property.latitude.toFixed(5)}, ${property.longitude.toFixed(5)}`,
    });
  }
  facts.push({ label: t('detail.createdAt'), value: formatDate(property.createdAt) });
  facts.push({ label: t('detail.updatedAt'), value: formatDate(property.updatedAt) });

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] px-3 py-2.5 text-sm text-[color-mix(in_oklab,var(--color-danger)_75%,var(--color-text))]"
        >
          <Icon name="alert" className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </div>
      )}

      {/*
        Doce columnas en xl: la ficha ocupa ocho y la columna lateral cuatro,
        arrancando en la misma fila que el visor. En una sola columna el orden
        del DOM ya es el correcto: preview, resumen accionable y después el
        detalle largo.
      */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:gap-6">
        <div className="min-w-0 xl:col-span-8 xl:col-start-1 xl:row-start-1">
          <PropertyGallery
            photos={mediaItems}
            title={property.title}
            seed={property.id}
            topLeft={<PropertyTypeBadge type={property.type} onCover />}
            topRight={primaryOp && <PropertyStateBadge state={primaryOp.state} onCover />}
          />
        </div>

        <aside className="min-w-0 space-y-4 self-start xl:col-span-4 xl:col-start-9 xl:row-span-2 xl:row-start-1">
          {/* Precio, estado y acciones — lo que se decide sobre la propiedad. */}
          <DetailSection>
            <p className="micro">{t('form.price')}</p>
            <p className="font-display mt-1 text-2xl font-medium tabular-nums tracking-[var(--tracking-tight)] text-[var(--color-text)] [overflow-wrap:anywhere] sm:text-3xl">
              {headlinePrice ? formatPrice(headlinePrice, headlineCurrency) : t('card.noPrice')}
            </p>
            {headlinePrice != null && (
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {primaryOp
                  ? `${t(`operationTypes.${primaryOp.operationType}`)} · ${headlineCurrency}`
                  : headlineCurrency}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <PropertyTypeBadge type={property.type} />
              {primaryOp && <PropertyStateBadge state={primaryOp.state} />}
              <Badge variant={property.isActive ? 'success' : 'neutral'} dot>
                {property.isActive ? t('detail.active') : t('detail.inactive')}
              </Badge>
            </div>

            {(canEdit || canDelete) && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                {canEdit && (
                  <button onClick={onEdit} className={cn(BUTTON_BASE, BUTTON_PRIMARY, 'flex-1')}>
                    <Icon name="edit" className="h-4 w-4" strokeWidth={2} />
                    {t('detail.edit')}
                  </button>
                )}
                {canDelete && (
                  <button onClick={onDelete} className={cn(BUTTON_BASE, BUTTON_DANGER)}>
                    <Icon name="trash" className="h-4 w-4" strokeWidth={2} />
                    {tCommon('delete')}
                  </button>
                )}
              </div>
            )}
          </DetailSection>

          {/* Operaciones y sus transiciones de estado. */}
          <DetailSection title={t('detail.operations')} icon="wallet">
            {operations.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('form.noOperations')}</p>
            ) : (
              <ul className="space-y-3">
                {operations.map((op) => {
                  const validNext = getValidTransitions(
                    op.operationType as PropertyOperationType,
                    op.state as PropertyState,
                  );
                  return (
                    <li
                      key={op.id}
                      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 text-sm font-semibold text-[var(--color-text)]">
                          {t(`operationTypes.${op.operationType}`)}
                        </span>
                        <PropertyStateBadge state={op.state} />
                      </div>
                      <p className="font-display mt-1 text-base font-medium tabular-nums text-[var(--color-text)] [overflow-wrap:anywhere]">
                        {op.price
                          ? formatPrice(op.price, op.currency)
                          : property.price
                            ? formatPrice(property.price, property.currency)
                            : t('card.noPrice')}
                      </p>

                      {canEdit && validNext.length > 0 && (
                        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                          <p className="micro mb-2">{t('detail.transitionTo')}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {validNext.map((next) => (
                              <button
                                key={next}
                                type="button"
                                disabled={transitionLoading === op.id}
                                onClick={() => handleTransition(op.id, next)}
                                className={cn(
                                  BUTTON_BASE,
                                  BUTTON_GHOST,
                                  'bg-[var(--color-surface)] px-2.5 py-1.5 text-xs',
                                )}
                              >
                                {t(`states.${next}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </DetailSection>

          <DetailSection title={t('detail.factSheet')} icon="properties">
            <FactList items={facts} />
          </DetailSection>

          <DetailSection title={t('priceHistory.title')} icon="trendingUp">
            <PriceHistory entries={property.priceHistory || []} />
          </DetailSection>
        </aside>

        <div className="min-w-0 space-y-5 xl:col-span-8 xl:col-start-1 xl:row-start-2">
          {/* Ubicación y descripción. */}
          <DetailSection title={t('form.description')} icon="text">
            <div className="mb-4 space-y-1.5 border-b border-[var(--color-border)] pb-4">
              {street && (
                <p className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                  <Icon
                    name="mapPin"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)]"
                    strokeWidth={1.8}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{street}</span>
                </p>
              )}
              {locality && (
                <p className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
                  <Icon
                    name="building"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    strokeWidth={1.8}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {locality}
                    {property.country ? ` · ${property.country}` : ''}
                  </span>
                </p>
              )}
              {!street && !locality && (
                <p className="text-sm text-[var(--color-muted)]">{t('card.noAddress')}</p>
              )}
            </div>

            {property.description ? (
              <ExpandableText
                text={property.description}
                moreLabel={t('detail.showMore')}
                lessLabel={t('detail.showLess')}
              />
            ) : (
              <p className="text-sm text-[var(--color-muted)]">{t('detail.noDescription')}</p>
            )}
          </DetailSection>

          {specs.length > 0 && (
            <DetailSection title={t('form.characteristics')} icon="rooms">
              <SpecGrid items={specs} />
            </DetailSection>
          )}

          {/* Amenidades: chips, no una lista separada por puntos. */}
          <DetailSection
            title={t('form.amenities')}
            icon="sparkles"
            action={
              amenities.length > 0 ? (
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  {amenities.length}
                </span>
              ) : undefined
            }
          >
            {amenities.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('detail.noAmenities')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {amenities.map((amenity) => (
                  <Badge key={amenity} variant="brand" size="md">
                    {t.has(`amenities.${amenity}`) ? t(`amenities.${amenity}`) : amenity}
                  </Badge>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection
            title={t('detail.linkedPersons')}
            icon="persons"
            action={
              personRoles.length > 0 ? (
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  {personRoles.length}
                </span>
              ) : undefined
            }
          >
            {personRoles.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t('detail.noLinkedPersons')}</p>
            ) : (
              <div className="space-y-3">
                {personRoles.map((pr) => {
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
                          {pr.person.email && (
                            <span className="max-w-[14rem] truncate">{pr.person.email}</span>
                          )}
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
          </DetailSection>

          {/* Gestión de fotos. Para quien solo puede leer, el visor de arriba ya
              muestra todo el material, así que este bloque no se duplica. */}
          {canEdit && (
            <DetailSection
              title={t('media.title')}
              icon="image"
              action={
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  {mediaItems.length}
                </span>
              }
            >
              <PropertyMediaUpload
                propertyId={property.id}
                media={mediaItems}
                onMediaChange={setMediaItems}
              />
            </DetailSection>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────── Loading placeholder ──────────── */

function DetailSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:gap-6" aria-hidden="true">
      <div className="min-w-0 space-y-3 xl:col-span-8">
        <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-2xl)] sm:aspect-[16/10] xl:aspect-[16/9]" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-20 rounded-[var(--radius-lg)] sm:h-16 sm:w-24" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-[var(--radius-2xl)]" />
      </div>
      <div className="min-w-0 space-y-4 xl:col-span-4">
        <Skeleton className="h-52 w-full rounded-[var(--radius-2xl)]" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-2xl)]" />
      </div>
    </div>
  );
}

/* ──────────── Main page ──────────── */

export default function PropertyDetailPage() {
  const t = useTranslations('properties');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const propertyId = params.id as string;
  const listHref = `${localePrefix}/properties`;

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
      router.push(listHref);
    } catch {
      // stay on page
    }
  }

  const backLink = (
    <Link
      href={listHref}
      aria-label={t('backToList')}
      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-colors duration-300 [transition-timing-function:var(--ease-luxe)] hover:border-[var(--color-brand-300)] hover:text-[var(--color-brand-600)]"
    >
      <Icon name="arrowLeft" className="h-4 w-4" strokeWidth={2} />
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          {backLink}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-2/3 max-w-sm" />
          </div>
        </div>
        <DetailSkeleton />
      </div>
    );
  }

  if (notFound || !property) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-4">{backLink}</div>
        <EmptyState
          iconName="properties"
          title={t('empty.detail')}
          action={
            <Link href={listHref} className={cn(BUTTON_BASE, BUTTON_GHOST)}>
              <Icon name="arrowLeft" className="h-4 w-4" strokeWidth={2} />
              {t('backToList')}
            </Link>
          }
        />
      </div>
    );
  }

  const street = streetLine(property);
  const locality = localityLine(property);
  const headerAddress = [street, locality].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      {/* Encabezado: el título de la propiedad es el título de la pantalla. */}
      <header className="flex items-start gap-3 sm:gap-4">
        {backLink}
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{editing ? t('editTitle') : t('detailTitle')}</p>
          <h1 className="h2 mt-1 [overflow-wrap:anywhere]">{property.title}</h1>
          {headerAddress && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-[var(--color-muted)]">
              <Icon name="mapPin" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{headerAddress}</span>
            </p>
          )}
        </div>
      </header>

      {deleteConfirm && (
        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-xl)] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] p-4 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-[color-mix(in_oklab,var(--color-danger)_78%,var(--color-text))]">
            {t('detail.deleteConfirm')}
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={handleDelete}
              className={cn(
                BUTTON_BASE,
                'bg-[var(--color-danger)] text-white shadow-sm hover:opacity-90',
              )}
            >
              {tCommon('confirm')}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className={cn(BUTTON_BASE, BUTTON_GHOST, 'bg-[var(--color-surface)]')}
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
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}
