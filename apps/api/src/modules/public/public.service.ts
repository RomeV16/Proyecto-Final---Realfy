import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ensureRole } from '../persons/person-roles.service';
import { randomUUID } from 'node:crypto';
import {
  ListingStatus,
  MICROSITE_PORTAL_KEY,
  resolveOperationalDefaults,
  PublicPropertyFilterSchema,
  CreatePublicInquirySchema,
  PropertyState,
  PropertyOperationType,
  PipelineType,
  LeadSource,
  ConversationChannel,
  normalizeEmail,
  normalizePhone,
  LeadStatus,
  PersonRole,
  UserRole,
} from '@realfy/shared';
import { parseOrThrow } from '../../common/validation/zod';
import { InboxIngestService } from '../inbox/inbox-ingest.service';

/**
 * Property columns exposed on the public portal. Never the address number, floor,
 * owner, tenant or internal notes: street/number/geo are added only when the
 * agency's publication settings allow them (see `_exposure`).
 */
const PROPERTY_LIST_SELECT = {
  id: true,
  title: true,
  type: true,
  price: true,
  currency: true,
  city: true,
  province: true,
  area: true,
  rooms: true,
  bedrooms: true,
  bathrooms: true,
  garages: true,
} as const;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxIngestService,
  ) {}

  // ─── Properties: List ─────────────────────────────────

  async findProperties(tenantId: string, query: unknown) {
    const filters: any = parseOrThrow(PublicPropertyFilterSchema, query, 'Invalid filter parameters');
    const exposure = await this._exposure(tenantId);
    const published = await this._publishedOperations(tenantId, {
      operation: filters.operation,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
    });

    const empty = { items: [], total: 0, page: filters.page, limit: filters.limit };
    if (!published) return empty;

    const where: any = { tenantId, isActive: true, ...published.propertyWhere };
    if (filters.type) where.type = filters.type;
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };

    const skip = (filters.page - 1) * filters.limit;

    const [rows, total] = await Promise.all([
      this.prisma.baseClient.property.findMany({
        where,
        select: {
          ...PROPERTY_LIST_SELECT,
          ...(exposure.showStreet ? { street: true } : {}),
          operations: {
            where: published.operationWhere,
            orderBy: { operationType: 'asc' },
            select: { operationType: true, price: true, currency: true },
          },
          media: {
            orderBy: { sortOrder: 'asc' },
            select: { url: true, thumbnailUrl: true, isPrimary: true },
          },
          _count: { select: { media: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: filters.limit,
      }),
      this.prisma.baseClient.property.count({ where }),
    ]);

    return {
      items: rows.map((row: any) => this._toListItem(row)),
      total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  /** Ids y fechas de las propiedades publicadas, para armar el sitemap. */
  async findSitemapEntries(tenantId: string) {
    const published = await this._publishedOperations(tenantId, {});
    if (!published) return { items: [] };
    const rows = await this.prisma.baseClient.property.findMany({
      where: { tenantId, isActive: true, ...published.propertyWhere },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    return { items: rows.map((r: any) => ({ id: r.id, updatedAt: r.updatedAt })) };
  }

  // ─── Properties: Detail ───────────────────────────────

  async findProperty(tenantId: string, propertyId: string) {
    const exposure = await this._exposure(tenantId);
    const published = await this._publishedOperations(tenantId, {});
    const property = published
      ? await this.prisma.baseClient.property.findFirst({
          where: { id: propertyId, tenantId, isActive: true, ...published.propertyWhere },
          select: {
            ...PROPERTY_LIST_SELECT,
            ...(exposure.showStreet ? { street: true, number: true } : {}),
            ...(exposure.showMap ? { latitude: true, longitude: true } : {}),
            description: true,
            amenities: true,
            age: true,
            orientation: true,
            updatedAt: true,
            operations: {
              where: published.operationWhere,
              orderBy: { operationType: 'asc' },
              select: { operationType: true, price: true, currency: true },
            },
            media: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: { url: true, thumbnailUrl: true, sortOrder: true, isPrimary: true },
            },
          },
        })
      : null;

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    const item = this._toListItem(property);
    const p: any = property;

    return {
      ...item,
      number: exposure.showStreet ? (p.number ?? null) : null,
      description: property.description ?? null,
      amenities: property.amenities,
      age: p.age ?? null,
      orientation: p.orientation ?? null,
      updatedAt: p.updatedAt,
      // Sólo si la inmobiliaria lo permite, y redondeado (~100 m): es la zona, no la puerta.
      location:
        exposure.showMap && p.latitude != null && p.longitude != null
          ? { lat: Math.round(p.latitude * 1000) / 1000, lng: Math.round(p.longitude * 1000) / 1000 }
          : null,
      media: property.media.map((m: any) => ({
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        sortOrder: m.sortOrder,
        isPrimary: m.isPrimary,
      })),
    };
  }

  // ─── Inquiries ─────────────────────────────────────────

  async createInquiry(tenantId: string, body: unknown) {
    const validated: any = parseOrThrow(CreatePublicInquirySchema, body, 'Invalid inquiry data');

    // Señuelo: un formulario real lo manda vacío. Se responde igual que a una consulta
    // válida para que el bot no note la diferencia, pero no se guarda nada.
    if (validated.website?.trim()) {
      this.logger.warn(`Public inquiry dropped by honeypot: tenantId=${tenantId}`);
      return { id: randomUUID() };
    }

    // Resolve the linked property, if any — silently drop it if it isn't
    // this tenant's or isn't currently available, rather than failing.
    let property: any = null;
    if (validated.propertyId) {
      const published = await this._publishedOperations(tenantId, {});
      if (published) {
        property = await this.prisma.baseClient.property.findFirst({
          where: { id: validated.propertyId, tenantId, isActive: true, ...published.propertyWhere },
          select: {
            id: true,
            operations: {
              where: published.operationWhere,
              orderBy: { operationType: 'asc' },
              select: { operationType: true },
            },
          },
        });
      }
    }

    const operationType = property?.operations[0]?.operationType;
    const pipeline = await this._resolvePipeline(tenantId, operationType);
    if (!pipeline) {
      throw new ConflictException({
        error: 'NO_PIPELINE_CONFIGURED',
        message: 'This inmobiliaria has no embudo configured',
      });
    }

    const personId = await this._findOrCreatePerson(tenantId, validated);
    const assignedToUserId = await this._roundRobinAssign(tenantId);

    const lead = await this.prisma.baseClient.lead.create({
      data: {
        tenantId,
        personId,
        pipelineId: pipeline.id,
        currentStageId: pipeline.stageId,
        propertyId: property?.id ?? null,
        assignedToUserId: assignedToUserId ?? null,
        source: LeadSource.WebInquiry,
        notes: validated.message,
      },
      select: { id: true },
    });

    this.logger.log(`Public inquiry created: leadId=${lead.id} tenantId=${tenantId}`);
    await this._openConversation(tenantId, validated, { leadId: lead.id, personId, propertyId: property?.id ?? null, assignedToUserId });

    return { id: lead.id };
  }

  /**
   * La consulta también entra en la bandeja (canal Web), junto al interés. Si no se
   * puede, la consulta ya quedó guardada como interés: el formulario no falla por eso.
   */
  private async _openConversation(
    tenantId: string,
    data: { firstName: string; lastName: string; email?: string; phone?: string; message: string },
    ctx: { leadId: string; personId: string; propertyId: string | null; assignedToUserId: string | null },
  ): Promise<void> {
    const address = normalizeEmail(data.email) ?? normalizePhone(data.phone);
    if (!address) return;
    try {
      await this.inbox.receive(tenantId, {
        channel: ConversationChannel.Web,
        address,
        name: `${data.firstName} ${data.lastName}`.trim(),
        subject: ctx.propertyId ? 'Consulta por una propiedad' : 'Consulta desde el sitio',
        body: data.message,
        at: new Date(),
        personId: ctx.personId,
        leadId: ctx.leadId,
        relatedType: ctx.propertyId ? 'Property' : null,
        relatedId: ctx.propertyId,
        assigneeUserId: ctx.assignedToUserId,
      });
    } catch (err) {
      this.logger.error(`Inbox hand-off failed for public inquiry: leadId=${ctx.leadId} error=${(err as Error).message}`);
    }
  }

  // ─── Private: qué se muestra ───────────────────────────

  /**
   * Qué datos de ubicación admite mostrar la inmobiliaria (publication.hideExactAddress
   * y publication.showMap). Por defecto: sólo la zona, sin calle ni mapa.
   */
  private async _exposure(tenantId: string): Promise<{ showStreet: boolean; showMap: boolean }> {
    const tenant = await this.prisma.baseClient.tenant.findUnique({
      where: { id: tenantId },
      select: { operationalDefaults: true },
    });
    const publication = resolveOperationalDefaults(tenant?.operationalDefaults).publication;
    return { showStreet: !publication.hideExactAddress, showMap: publication.showMap };
  }

  /**
   * Sólo se muestra lo que alguien marcó explícitamente: una operación Disponible cuyo
   * aviso en el portal "micrositio" está Publicado y no venció. Devuelve los filtros de
   * propiedad y de operación que lo expresan (null si no hay nada publicado).
   */
  private async _publishedOperations(
    tenantId: string,
    opts: { operation?: PropertyOperationType; minPrice?: number; maxPrice?: number },
  ): Promise<{ propertyWhere: any; operationWhere: any } | null> {
    const listings = await this.prisma.baseClient.propertyListing.findMany({
      where: {
        tenantId,
        portal: MICROSITE_PORTAL_KEY,
        status: ListingStatus.Publicado,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(opts.operation ? { operationType: opts.operation } : {}),
      },
      select: { propertyId: true, operationType: true },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    if (listings.length === 0) return null;

    const idsByType = new Map<string, string[]>();
    for (const l of listings) {
      idsByType.set(l.operationType, [...(idsByType.get(l.operationType) ?? []), l.propertyId]);
    }
    const price: any = {};
    if (opts.minPrice !== undefined) price.gte = opts.minPrice;
    if (opts.maxPrice !== undefined) price.lte = opts.maxPrice;
    const priceFilter = Object.keys(price).length > 0 ? { price } : {};

    // Una cláusula por tipo de operación: el aviso y el estado Disponible tienen que ser
    // de la misma operación, no de dos distintas de la misma propiedad.
    const perType = [...idsByType.entries()].map(([operationType, ids]) => ({
      operationType: operationType as PropertyOperationType,
      propertyId: { in: ids },
      state: PropertyState.Disponible,
      ...priceFilter,
    }));
    return {
      operationWhere: { OR: perType },
      propertyWhere: { operations: { some: { OR: perType } } },
    };
  }

  // ─── Private: shape a property row into the public list/detail item ────

  private _toListItem(row: any) {
    const availableOp = row.operations?.[0];
    const primaryMedia = row.media?.find((m: any) => m.isPrimary) ?? row.media?.[0] ?? null;

    return {
      id: row.id,
      title: row.title,
      type: row.type,
      operationType: availableOp?.operationType ?? null,
      price: availableOp?.price ?? row.price,
      currency: availableOp?.currency ?? row.currency,
      city: row.city,
      province: row.province,
      street: row.street ?? null,
      area: row.area,
      rooms: row.rooms,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      garages: row.garages,
      coverUrl: primaryMedia ? primaryMedia.thumbnailUrl ?? primaryMedia.url : null,
      mediaCount: row._count?.media ?? row.media?.length ?? 0,
    };
  }

  // ─── Private: pick the tenant's embudo + first stage for a new lead ────

  /**
   * Prefers the pipeline matching the linked property's operation type
   * (Venta -> Venta pipeline, Alquiler/Temporario -> Alquiler pipeline).
   * Falls back to any active pipeline that has at least one stage.
   */
  private async _resolvePipeline(
    tenantId: string,
    operationType?: PropertyOperationType,
  ): Promise<{ id: string; stageId: string } | null> {
    const preferredType = !operationType
      ? undefined
      : operationType === PropertyOperationType.Venta
        ? PipelineType.Venta
        : PipelineType.Alquiler;

    const pipelines = await this.prisma.baseClient.pipeline.findMany({
      where: { tenantId, isActive: true },
      orderBy: { type: 'asc' },
      select: {
        id: true,
        type: true,
        stages: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true } },
      },
    });

    const withStages = pipelines.filter((p: any) => p.stages.length > 0);
    if (withStages.length === 0) return null;

    const chosen =
      (preferredType && withStages.find((p: any) => p.type === preferredType)) ?? withStages[0];

    return { id: chosen.id, stageId: chosen.stages[0].id };
  }

  // ─── Private: find-or-create the person behind the inquiry ─────────────

  private async _findOrCreatePerson(
    tenantId: string,
    data: { firstName: string; lastName: string; email?: string; phone?: string },
  ): Promise<string> {
    const orConditions: any[] = [];
    if (data.email) orConditions.push({ email: data.email });
    if (data.phone) orConditions.push({ phone: data.phone });

    if (orConditions.length > 0) {
      const existing = await this.prisma.baseClient.person.findFirst({
        where: { tenantId, OR: orConditions },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const person = await this.prisma.baseClient.person.create({
      data: {
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
      },
      select: { id: true },
    });

    await ensureRole(this.prisma.baseClient, person.id, PersonRole.Lead);

    return person.id;
  }

  // ─── Private: round-robin assignment among active Ventas users ─────────

  private async _roundRobinAssign(tenantId: string): Promise<string | null> {
    const ventasUsers = await this.prisma.baseClient.user.findMany({
      where: { tenantId, role: UserRole.Ventas, isActive: true },
      select: { id: true },
    });

    if (ventasUsers.length === 0) return null;

    const leadCounts = await Promise.all(
      ventasUsers.map(async (user: any) => {
        const count = await this.prisma.baseClient.lead.count({
          where: {
            tenantId,
            assignedToUserId: user.id,
            status: { in: [LeadStatus.Nuevo, LeadStatus.Contactado, LeadStatus.Calificado] },
            isActive: true,
          },
        });
        return { userId: user.id, count };
      }),
    );

    leadCounts.sort((a, b) => a.count - b.count);
    return leadCounts[0].userId;
  }
}
