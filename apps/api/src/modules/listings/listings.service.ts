import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdCopyQuerySchema,
  ListingStatus,
  MICROSITE_PORTAL_KEY,
  PropertyState,
  PublicationSettingsSchema,
  UpsertListingsSchema,
  buildAdCopy,
  listingUrlFromTemplate,
  type PortalConfig,
  type PublicationSettings,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';

/** Estados de una operación en los que un aviso puede estar publicado. */
const PUBLISHABLE_STATES: string[] = [PropertyState.Disponible, PropertyState.Reservado];

const DAY_MS = 86_400_000;

export interface PortalCatalogEntry extends PortalConfig {
  /** El micrositio propio: siempre está y no se configura. */
  builtin: boolean;
}

/** Estado vigente: un aviso publicado con la fecha de vencimiento pasada es un aviso vencido. */
export function effectiveListingStatus(
  row: { status: string; expiresAt: Date | null },
  now: Date,
): ListingStatus {
  if (row.status === ListingStatus.Publicado && row.expiresAt && row.expiresAt.getTime() < now.getTime()) {
    return ListingStatus.Vencido;
  }
  return row.status as ListingStatus;
}

export function portalCatalog(settings: PublicationSettings): PortalCatalogEntry[] {
  return [
    { key: MICROSITE_PORTAL_KEY, name: 'Micrositio', urlTemplate: null, enabled: true, builtin: true },
    ...settings.portals.map((p) => ({ ...p, builtin: false })),
  ];
}

const byTitle = (a: { title: string; propertyId: string }, b: { title: string; propertyId: string }) =>
  a.title.localeCompare(b.title, 'es') || a.propertyId.localeCompare(b.propertyId);

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly defaults: OperationalDefaultsService,
  ) {}

  private tenantId(): string {
    const id = this.tenantContext.getTenantId();
    if (!id) {
      throw new ForbiddenException({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required' });
    }
    return id;
  }

  async getSettings(): Promise<PublicationSettings> {
    return (await this.defaults.get(this.tenantId())).publication;
  }

  // ─── Configuración de portales ──────────────────────

  async getPortals() {
    const settings = await this.getSettings();
    return { ...settings, catalog: portalCatalog(settings) };
  }

  async updatePortals(body: unknown) {
    const validated = parseOrThrow(PublicationSettingsSchema, body, 'Invalid publication settings');
    const tenantId = this.tenantId();
    const current = await this.defaults.get(tenantId);
    await this.defaults.set(tenantId, { ...current, publication: validated });
    return { ...validated, catalog: portalCatalog(validated) };
  }

  // ─── Avisos de una propiedad ────────────────────────

  private async loadProperty(propertyId: string) {
    const property = await this.prisma.client.property.findFirst({
      where: { id: propertyId },
      select: {
        id: true,
        type: true,
        description: true,
        street: true,
        number: true,
        city: true,
        province: true,
        area: true,
        rooms: true,
        bedrooms: true,
        bathrooms: true,
        garages: true,
        age: true,
        orientation: true,
        amenities: true,
        price: true,
        currency: true,
        operations: {
          orderBy: { operationType: 'asc' },
          select: { operationType: true, state: true, price: true, currency: true },
        },
      },
    });
    if (!property) {
      throw new NotFoundException({ error: 'PROPERTY_NOT_FOUND', message: 'Property not found' });
    }
    return property;
  }

  async findForProperty(propertyId: string) {
    const settings = await this.getSettings();
    const catalog = portalCatalog(settings);
    const property = await this.loadProperty(propertyId);
    const rows = await this.prisma.client.propertyListing.findMany({
      where: { propertyId },
      orderBy: [{ operationType: 'asc' }, { portal: 'asc' }],
      include: { updatedBy: { select: { firstName: true, lastName: true } } },
    });
    const now = new Date();
    const templates = new Map(catalog.map((p) => [p.key, p.urlTemplate]));
    const tenant = await this.prisma.baseClient.tenant.findUnique({
      where: { id: this.tenantId() },
      select: { slug: true },
    });
    return {
      settings: { expiryWarnDays: settings.expiryWarnDays },
      /** Dónde vive la ficha en el micrositio (null si la inmobiliaria no tiene slug). */
      micrositePath: tenant?.slug ? `/p/${tenant.slug}/propiedades/${propertyId}` : null,
      portals: catalog,
      operations: property.operations.map((o) => ({ operationType: o.operationType, state: o.state })),
      listings: rows.map((r) => ({
        id: r.id,
        operationType: r.operationType,
        portal: r.portal,
        status: r.status,
        effectiveStatus: effectiveListingStatus(r, now),
        externalUrl: r.externalUrl ?? listingUrlFromTemplate(templates.get(r.portal), r.externalCode),
        externalCode: r.externalCode,
        publishedAt: r.publishedAt,
        expiresAt: r.expiresAt,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy ? `${r.updatedBy.firstName} ${r.updatedBy.lastName}`.trim() : null,
      })),
    };
  }

  async upsertForProperty(propertyId: string, body: unknown) {
    const validated = parseOrThrow(UpsertListingsSchema, body, 'Invalid listings data');
    const tenantId = this.tenantId();
    const userId = this.tenantContext.getUserId() ?? null;
    const settings = await this.getSettings();
    const portals = new Map(portalCatalog(settings).map((p) => [p.key, p]));
    const property = await this.loadProperty(propertyId);
    const operations = new Map(property.operations.map((o) => [o.operationType as string, o]));
    const now = new Date();

    for (const entry of validated.listings) {
      const portal = portals.get(entry.portal);
      if (!portal) {
        throw new BadRequestException({ error: 'PORTAL_UNKNOWN', message: `Unknown portal: ${entry.portal}` });
      }
      const operation = operations.get(entry.operationType);
      if (!operation) {
        throw new BadRequestException({
          error: 'OPERATION_NOT_FOUND',
          message: `The property has no ${entry.operationType} operation`,
        });
      }
      if (entry.status === ListingStatus.Publicado) {
        if (!portal.enabled) {
          throw new ConflictException({ error: 'PORTAL_DISABLED', message: `Portal ${entry.portal} is disabled` });
        }
        if (!PUBLISHABLE_STATES.includes(operation.state)) {
          throw new ConflictException({
            error: 'OPERATION_NOT_PUBLISHABLE',
            message: `A ${operation.state} operation cannot be published`,
            state: operation.state,
          });
        }
        if (entry.expiresAt && entry.expiresAt.getTime() < now.getTime()) {
          throw new BadRequestException({ error: 'EXPIRY_IN_PAST', message: 'The expiry date is in the past' });
        }
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      for (const entry of validated.listings) {
        const existing = await tx.propertyListing.findFirst({
          where: { propertyId, operationType: entry.operationType, portal: entry.portal },
        });
        const publishedAt =
          entry.publishedAt !== undefined
            ? entry.publishedAt
            : entry.status === ListingStatus.Publicado && !existing?.publishedAt
              ? now
              : (existing?.publishedAt ?? null);
        const data = {
          status: entry.status,
          externalUrl: entry.externalUrl !== undefined ? entry.externalUrl : (existing?.externalUrl ?? null),
          externalCode: entry.externalCode !== undefined ? entry.externalCode : (existing?.externalCode ?? null),
          publishedAt,
          expiresAt: entry.expiresAt !== undefined ? entry.expiresAt : (existing?.expiresAt ?? null),
          updatedByUserId: userId,
        };
        if (existing) {
          await tx.propertyListing.update({ where: { id: existing.id }, data });
        } else {
          await tx.propertyListing.create({
            data: { ...data, tenantId, propertyId, operationType: entry.operationType, portal: entry.portal },
          });
        }
      }
    });

    this.logger.log(`Avisos actualizados: property=${propertyId} cantidad=${validated.listings.length}`);
    return this.findForProperty(propertyId);
  }

  // ─── Aviso optimizado ───────────────────────────────

  async adCopy(propertyId: string, query: unknown) {
    const parsed = parseOrThrow(AdCopyQuerySchema, query, 'Invalid ad copy query');
    const settings = await this.getSettings();
    const portal = portalCatalog(settings).find((p) => p.key === parsed.portal);
    if (!portal) {
      throw new BadRequestException({ error: 'PORTAL_UNKNOWN', message: `Unknown portal: ${parsed.portal}` });
    }
    const property = await this.loadProperty(propertyId);
    const operation = parsed.operation
      ? property.operations.find((o) => o.operationType === parsed.operation)
      : (property.operations.find((o) => o.state === PropertyState.Disponible) ?? property.operations[0]);
    if (!operation) {
      throw new BadRequestException({
        error: 'OPERATION_NOT_FOUND',
        message: 'The property has no matching operation',
      });
    }
    const media = await this.prisma.client.propertyMedia.findMany({
      where: { propertyId },
      select: { id: true, url: true, sortOrder: true, isPrimary: true },
    });
    const copy = buildAdCopy(
      {
        type: property.type,
        operationType: operation.operationType,
        price: operation.price != null ? Number(operation.price) : property.price != null ? Number(property.price) : null,
        currency: operation.price != null ? operation.currency : property.currency,
        city: property.city,
        province: property.province,
        street: property.street,
        number: property.number,
        area: property.area,
        rooms: property.rooms,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        garages: property.garages,
        age: property.age,
        orientation: property.orientation,
        amenities: property.amenities,
        description: property.description,
        photos: media,
      },
      { portal: portal.key, hideExactAddress: settings.hideExactAddress },
    );
    return { propertyId, portalName: portal.name, ...copy };
  }

  // ─── Resumen: qué falta publicar y qué hay que bajar ─

  async overview() {
    const settings = await this.getSettings();
    const now = new Date();
    const warnUntil = new Date(now.getTime() + settings.expiryWarnDays * DAY_MS);
    const portalNames = new Map(portalCatalog(settings).map((p) => [p.key, p.name]));

    const live = await this.prisma.client.propertyListing.findMany({
      where: { status: { in: [ListingStatus.Publicado, ListingStatus.Vencido] } },
      select: {
        id: true,
        propertyId: true,
        operationType: true,
        portal: true,
        status: true,
        expiresAt: true,
        externalUrl: true,
        property: { select: { title: true, isActive: true } },
      },
      take: 2000,
    });
    const available = await this.prisma.client.propertyOperation.findMany({
      where: { state: PropertyState.Disponible, property: { isActive: true } },
      select: {
        propertyId: true,
        operationType: true,
        property: { select: { title: true, type: true, city: true } },
      },
      take: 2000,
    });
    const opStates = await this.prisma.client.propertyOperation.findMany({
      where: { propertyId: { in: [...new Set(live.map((l) => l.propertyId))] } },
      select: { propertyId: true, operationType: true, state: true },
    });
    const stateOf = new Map(opStates.map((o) => [`${o.propertyId}:${o.operationType}`, o.state as string]));

    const rows = live.map((l) => ({
      ...l,
      effective: effectiveListingStatus(l, now),
      portalName: portalNames.get(l.portal) ?? l.portal,
      title: l.property.title,
      operationState: stateOf.get(`${l.propertyId}:${l.operationType}`) ?? null,
    }));
    const published = rows.filter((r) => r.effective === ListingStatus.Publicado);

    const publishedKeys = new Set(published.map((r) => `${r.propertyId}:${r.operationType}`));
    const notPublished = available
      .filter((o) => !publishedKeys.has(`${o.propertyId}:${o.operationType}`))
      .map((o) => ({
        propertyId: o.propertyId,
        title: o.property.title,
        type: o.property.type,
        city: o.property.city,
        operationType: o.operationType,
      }))
      .sort(byTitle);

    const shape = (r: (typeof rows)[number]) => ({
      listingId: r.id,
      propertyId: r.propertyId,
      title: r.title,
      operationType: r.operationType,
      portal: r.portal,
      portalName: r.portalName,
      status: r.effective,
      expiresAt: r.expiresAt,
      externalUrl: r.externalUrl,
      operationState: r.operationState,
    });
    const byExpiry = (a: ReturnType<typeof shape>, b: ReturnType<typeof shape>) =>
      (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0) || byTitle(a, b);

    const expiring = published
      .filter((r) => r.expiresAt && r.expiresAt.getTime() <= warnUntil.getTime())
      .map(shape)
      .sort(byExpiry);
    const expired = rows
      .filter((r) => r.effective === ListingStatus.Vencido)
      .map(shape)
      .sort(byExpiry);
    const shouldPause = published
      .filter((r) => this.mustBePaused(r))
      .map(shape)
      .sort(byTitle);

    const perPortal = new Map<string, number>();
    for (const r of published) perPortal.set(r.portal, (perPortal.get(r.portal) ?? 0) + 1);

    return {
      generatedAt: now,
      expiryWarnDays: settings.expiryWarnDays,
      counts: {
        notPublished: notPublished.length,
        expiring: expiring.length,
        expired: expired.length,
        shouldPause: shouldPause.length,
        published: published.length,
      },
      perPortal: [...perPortal.entries()]
        .map(([portal, count]) => ({ portal, portalName: portalNames.get(portal) ?? portal, count }))
        .sort((a, b) => a.portalName.localeCompare(b.portalName, 'es')),
      notPublished,
      expiring,
      expired,
      shouldPause,
    };
  }

  /** Un aviso publicado de una operación que ya no está disponible (alquilada, vendida, archivada...) o de una propiedad dada de baja. */
  private mustBePaused(r: { operationState: string | null; property: { isActive: boolean } }): boolean {
    return !r.property.isActive || r.operationState === null || !PUBLISHABLE_STATES.includes(r.operationState);
  }

  /** Pasa a Pausado los avisos publicados que ya no corresponden. */
  async pauseUnavailable() {
    const overview = await this.overview();
    const ids = overview.shouldPause.map((r) => r.listingId);
    if (ids.length === 0) return { paused: 0 };
    const result = await this.prisma.client.propertyListing.updateMany({
      where: { id: { in: ids } },
      data: { status: ListingStatus.Pausado, updatedByUserId: this.tenantContext.getUserId() ?? null },
    });
    this.logger.log(`Avisos pausados por no estar disponibles: ${result.count}`);
    return { paused: result.count };
  }
}
