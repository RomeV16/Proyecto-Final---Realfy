'use client';

import { useTranslations } from 'next-intl';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { PublicPropertyListItem } from '@/lib/public-portal';

/**
 * Grilla de propiedades del portal público.
 *
 * `CardGrid` resuelve la transición carga → contenido → vacío con animación,
 * lo que la hace un Client Component — por eso vive separada de la página
 * (Server Component). Los datos ya llegan resueltos desde el servidor; acá
 * solo se arma la tarjeta y se anima la lista.
 */

function formatPrice(price: number | string, currency?: string | null): string {
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${Number(price).toLocaleString('es-AR')}`;
}

function PublicPropertyCard({
  property,
  href,
}: {
  property: PublicPropertyListItem;
  href: string;
}) {
  const t = useTranslations('properties');

  // En la práctica siempre viene una operación — el listado público solo
  // trae propiedades con al menos una operación disponible — pero el tipo
  // la deja nullable, así que la etiqueta se arma con esa guarda.
  const operationLabel = property.operationType ? t(`operationTypes.${property.operationType}`) : null;
  const address = [property.street, property.city, property.province].filter(Boolean).join(', ');

  const specs: Array<{ icon?: 'mapPin'; label: string }> = [];
  if (property.rooms) specs.push({ label: `${property.rooms} amb.` });
  if (property.bedrooms) specs.push({ label: `${property.bedrooms} dorm.` });
  if (property.area) specs.push({ label: `${property.area} m²` });
  if (property.city) specs.push({ icon: 'mapPin', label: property.city });

  return (
    <EntityCard href={href} label={property.title} featured>
      <EntityCard.Cover
        src={property.coverUrl}
        alt={property.title}
        seed={property.id}
        icon="properties"
        aspect="aspect-[3/2]"
        topLeft={<Badge variant="brand" onCover>{t(`types.${property.type}`)}</Badge>}
        topRight={operationLabel && <Badge onCover>{operationLabel}</Badge>}
        bottomLeft={
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-sm">
            {property.title}
          </h3>
        }
        bottomRight={
          property.mediaCount > 0 && (
            <Badge onCover>
              <Icon name="image" className="h-3 w-3" strokeWidth={2} />
              {property.mediaCount}
            </Badge>
          )
        }
      />

      <EntityCard.Body>
        {property.price ? (
          <EntityCard.Amount
            value={formatPrice(property.price, property.currency)}
            hint={operationLabel}
          />
        ) : (
          <EntityCard.Amount value={t('card.noPrice')} tone="muted" />
        )}

        <EntityCard.Meta
          items={specs.length ? specs : [{ icon: 'mapPin', label: address || t('card.noAddress') }]}
        />
      </EntityCard.Body>

      <EntityCard.Footer>
        <p className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
          {address || t('card.noAddress')}
        </p>
        <EntityCard.Actions>
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {t('card.view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
  );
}

export function PublicPropertyGrid({
  items,
  locale,
  slug,
  filtered,
}: {
  items: PublicPropertyListItem[];
  locale: string;
  slug: string;
  filtered: boolean;
}) {
  const t = useTranslations('portalPublico');

  return (
    <CardGrid
      items={items}
      loading={false}
      columns={3}
      keyOf={(property) => property.id}
      renderItem={(property) => (
        <PublicPropertyCard
          property={property}
          href={`/${locale}/p/${slug}/propiedades/${property.id}`}
        />
      )}
      empty={
        <EmptyState
          variant={filtered ? 'filtered' : 'default'}
          iconName="properties"
          title={filtered ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
          subtitle={filtered ? t('list.emptyFilteredSubtitle') : t('list.emptySubtitle')}
        />
      }
    />
  );
}
