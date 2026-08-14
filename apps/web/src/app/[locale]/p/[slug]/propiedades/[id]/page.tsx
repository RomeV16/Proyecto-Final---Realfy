import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getRealtorProfile, getPublicProperty } from '@/lib/public-portal';
import { PropertyGallery, type GalleryPhoto } from '@/components/properties/property-gallery';
import { PropertyTypeBadge } from '@/components/properties/property-type-badge';
import {
  DetailSection,
  ExpandableText,
  FactList,
  SpecGrid,
  type Fact,
  type SpecItem,
} from '@/components/properties/property-detail-sections';
import { InquiryForm } from '@/components/portal-publico/inquiry-form';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

interface PropertyDetailProps {
  params: Promise<{ locale: string; slug: string; id: string }>;
}

function formatPrice(price: number | string, currency?: string | null): string {
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${Number(price).toLocaleString('es-AR')}`;
}

/** Calle 1234, Ciudad, Provincia */
function addressLine(property: { street?: string | null; city?: string | null; province?: string | null }): string {
  return [property.street, property.city, property.province].filter(Boolean).join(', ');
}

export default async function PublicPropertyDetailPage({ params }: PropertyDetailProps) {
  const { locale, slug, id } = await params;

  const profile = await getRealtorProfile(slug);
  if (!profile) notFound();

  const property = await getPublicProperty(slug, id);
  if (!property) notFound();

  const t = await getTranslations('properties');
  const tPortal = await getTranslations('portalPublico');

  const photos: GalleryPhoto[] = (property.media || []).map((m, i) => ({
    id: `${property.id}-${i}`,
    url: m.url,
    thumbnailUrl: m.thumbnailUrl || undefined,
    isPrimary: m.isPrimary,
    sortOrder: m.sortOrder,
  }));

  const specs: SpecItem[] = [];
  if (property.area != null) specs.push({ icon: 'area', label: t('form.totalArea'), value: `${property.area} m²` });
  if (property.rooms != null) specs.push({ icon: 'rooms', label: t('form.rooms'), value: property.rooms });
  if (property.bedrooms != null) {
    specs.push({ icon: 'bedrooms', label: t('form.bedrooms'), value: property.bedrooms });
  }
  if (property.bathrooms != null) {
    specs.push({ icon: 'bathrooms', label: t('form.bathrooms'), value: property.bathrooms });
  }
  if (property.garages != null) specs.push({ icon: 'garages', label: t('form.garages'), value: property.garages });

  const address = addressLine(property);
  const facts: Fact[] = [{ label: t('form.type'), value: t(`types.${property.type}`) }];
  if (property.street) facts.push({ label: t('form.address'), value: property.street });
  if (property.city) facts.push({ label: t('form.city'), value: property.city });
  if (property.province) facts.push({ label: t('form.province'), value: property.province });

  const amenities = property.amenities || [];
  // La operación disponible casi nunca falta —el listado ya filtra por eso—
  // pero el tipo la deja nullable, así que la etiqueta se resuelve con guarda.
  const operationLabel = property.operationType
    ? t(`operationTypes.${property.operationType}`)
    : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/p/${slug}#propiedades`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-brand-600)]"
      >
        <Icon name="arrowLeft" className="h-4 w-4" strokeWidth={2} />
        {tPortal('detail.backToList')}
      </Link>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:gap-6">
        <div className="min-w-0 xl:col-span-8 xl:col-start-1 xl:row-start-1">
          <PropertyGallery
            photos={photos}
            title={property.title}
            seed={property.id}
            topLeft={<PropertyTypeBadge type={property.type} onCover />}
            topRight={operationLabel && <Badge onCover>{operationLabel}</Badge>}
          />
        </div>

        <aside className="min-w-0 space-y-4 self-start xl:col-span-4 xl:col-start-9 xl:row-span-2 xl:row-start-1">
          <DetailSection>
            <h1 className="h3 [overflow-wrap:anywhere]">{property.title}</h1>
            {address && (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-[var(--color-muted)]">
                <Icon name="mapPin" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{address}</span>
              </p>
            )}

            <p className="font-display mt-4 text-2xl font-medium tabular-nums tracking-[var(--tracking-tight)] text-[var(--color-text)] [overflow-wrap:anywhere] sm:text-3xl">
              {property.price ? formatPrice(property.price, property.currency) : t('card.noPrice')}
            </p>
            {property.price != null && (
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {operationLabel}
                {property.currency ? ` · ${property.currency}` : ''}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <PropertyTypeBadge type={property.type} />
              {operationLabel && <Badge variant="brand">{operationLabel}</Badge>}
            </div>
          </DetailSection>

          <DetailSection title={tPortal('inquiry.title')} icon="mail">
            <p className="mb-4 text-sm text-[var(--color-muted)]">{tPortal('inquiry.subtitle')}</p>
            <InquiryForm slug={slug} propertyId={property.id} />
          </DetailSection>
        </aside>

        <div className="min-w-0 space-y-5 xl:col-span-8 xl:col-start-1 xl:row-start-2">
          <DetailSection title={tPortal('detail.descriptionTitle')} icon="text">
            {property.description ? (
              <ExpandableText
                text={property.description}
                moreLabel={t('detail.showMore')}
                lessLabel={t('detail.showLess')}
              />
            ) : (
              <p className="text-sm text-[var(--color-muted)]">{tPortal('detail.noDescription')}</p>
            )}
          </DetailSection>

          {specs.length > 0 && (
            <DetailSection title={tPortal('detail.specsTitle')} icon="rooms">
              <SpecGrid items={specs} />
            </DetailSection>
          )}

          <DetailSection title={tPortal('detail.amenitiesTitle')} icon="sparkles">
            {amenities.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{tPortal('detail.noAmenities')}</p>
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

          <DetailSection title={t('detail.factSheet')} icon="properties">
            <FactList items={facts} />
          </DetailSection>
        </div>
      </div>
    </div>
  );
}
