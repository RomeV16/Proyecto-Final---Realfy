import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateProviderProfileSchema,
  UpdateProviderProfileSchema,
  ProviderFilterSchema,
  PersonRole,
} from '@realfy/shared';

/**
 * Checks if an error is a Zod validation error (K006 pattern — no direct zod import).
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Create ─────────────────────────────────────────

  /**
   * Create a provider: Person with Proveedor role + ProviderProfile in a single transaction.
   * Body must include person fields (firstName, lastName, etc.) plus profile fields (rubros, coverageZones).
   */
  async create(body: unknown) {
    const data = body as Record<string, any>;
    const tenantId = this.tenantContext.getTenantId()!;

    // Extract profile fields
    const profileFields = {
      rubros: data.rubros,
      coverageZones: data.coverageZones,
      notes: data.notes,
    };

    // Extract person fields (everything else)
    const {
      rubros: _r,
      coverageZones: _c,
      notes: _n,
      ...personFields
    } = data;

    // Create Person + Proveedor role + ProviderProfile in one transaction
    const result = await this.prisma.client.$transaction(async (tx: any) => {
      // Create the person
      const person = await tx.person.create({
        data: {
          ...personFields,
          tenantId,
        },
      });

      // Assign Proveedor role
      await tx.personRoleAssignment.create({
        data: {
          personId: person.id,
          role: PersonRole.Proveedor,
          tenantId,
        },
      });

      // Validate and create provider profile
      let profileValidated: any;
      try {
        profileValidated = CreateProviderProfileSchema.parse({
          personId: person.id,
          ...profileFields,
        });
      } catch (err) {
        if (isZodError(err)) {
          throw new BadRequestException({
            error: 'VALIDATION_ERROR',
            message: 'Invalid provider profile data',
            details: err.errors,
          });
        }
        throw err;
      }

      const profile = await tx.providerProfile.create({
        data: {
          personId: person.id,
          tenantId,
          rubros: profileValidated.rubros,
          coverageZones: profileValidated.coverageZones,
          notes: profileValidated.notes ?? null,
        },
      });

      return {
        ...person,
        providerProfile: profile,
        roles: [{ role: PersonRole.Proveedor }],
      };
    });

    this.logger.log(
      `Provider created: personId=${result.id} name=${result.firstName} ${result.lastName}`,
    );

    return result;
  }

  // ─── List ─────────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = ProviderFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid filter parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const { page, limit, ...where } = filters;
    const skip = (page - 1) * limit;

    // Build where clause: persons that have a providerProfile
    const profileWhere: any = {};

    // Filter by rubros (Prisma `has` on String[])
    if (where.rubro) {
      profileWhere.rubros = { has: where.rubro };
    }

    // Filter by coverageZone
    if (where.zone) {
      profileWhere.coverageZones = { has: where.zone };
    }

    // Filter by isActive on the profile
    if (where.isActive !== undefined) {
      profileWhere.isActive = where.isActive;
    }

    // Build final where — use `isNot: null` only when no other profile filters
    const prismaWhere: any = {};
    if (Object.keys(profileWhere).length > 0) {
      prismaWhere.providerProfile = { is: profileWhere };
    } else {
      prismaWhere.providerProfile = { isNot: null };
    }

    // Text search on person firstName, lastName
    if (where.search) {
      prismaWhere.OR = [
        { firstName: { contains: where.search, mode: 'insensitive' } },
        { lastName: { contains: where.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.client.person.findMany({
        where: prismaWhere,
        skip,
        take: limit,
        orderBy: { lastName: 'asc' },
        include: {
          providerProfile: true,
          roles: true,
        },
      }),
      this.prisma.client.person.count({ where: prismaWhere }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Detail ───────────────────────────────────────────

  async findOne(id: string) {
    const person = await this.prisma.client.person.findFirst({
      where: {
        id,
        providerProfile: { isNot: null },
      },
      include: {
        providerProfile: true,
        roles: true,
      },
    });

    if (!person) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_FOUND',
        message: `Provider ${id} not found`,
      });
    }

    return person;
  }

  // ─── Update ───────────────────────────────────────────

  async update(id: string, body: unknown) {
    const data = body as Record<string, any>;

    // Find provider (person with providerProfile)
    const existing = await this.prisma.client.person.findFirst({
      where: {
        id,
        providerProfile: { isNot: null },
      },
      include: { providerProfile: true },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_FOUND',
        message: `Provider ${id} not found`,
      });
    }

    // Separate profile fields from person fields
    const { rubros, coverageZones, notes, isActive: profileIsActive, ...personFields } = data;
    const profileData: Record<string, any> = {};

    if (rubros !== undefined) profileData.rubros = rubros;
    if (coverageZones !== undefined) profileData.coverageZones = coverageZones;
    if (notes !== undefined) profileData.notes = notes;
    if (profileIsActive !== undefined) profileData.isActive = profileIsActive;

    // Validate profile updates if any
    if (Object.keys(profileData).length > 0) {
      try {
        UpdateProviderProfileSchema.parse(profileData);
      } catch (err) {
        if (isZodError(err)) {
          throw new BadRequestException({
            error: 'VALIDATION_ERROR',
            message: 'Invalid provider profile data',
            details: err.errors,
          });
        }
        throw err;
      }
    }

    // Update person fields and profile in transaction
    const result = await this.prisma.client.$transaction(async (tx: any) => {
      // Update person fields if any
      let person: any;
      if (Object.keys(personFields).length > 0) {
        person = await tx.person.update({
          where: { id },
          data: personFields,
        });
      } else {
        person = existing;
      }

      // Update profile if any profile fields changed
      let profile = existing.providerProfile;
      if (Object.keys(profileData).length > 0) {
        profile = await tx.providerProfile.update({
          where: { id: existing.providerProfile!.id },
          data: profileData,
        });
      }

      return { ...person, providerProfile: profile };
    });

    this.logger.log(`Provider updated: personId=${id}`);

    return result;
  }

  // ─── Soft Delete ──────────────────────────────────────

  async softDelete(id: string) {
    const existing = await this.prisma.client.person.findFirst({
      where: {
        id,
        providerProfile: { isNot: null },
      },
      include: { providerProfile: true },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_FOUND',
        message: `Provider ${id} not found`,
      });
    }

    // Soft-delete both person and profile
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.person.update({
        where: { id },
        data: { isActive: false },
      });
      await tx.providerProfile.update({
        where: { id: existing.providerProfile!.id },
        data: { isActive: false },
      });
    });

    this.logger.log(`Provider soft-deleted: personId=${id}`);

    return { deleted: true };
  }

  // ─── For Ticket (filtered by rubro + zone) ────────────

  /**
   * GET /providers/for-ticket/:ticketId
   * Returns providers filtered by the ticket's category name (as rubro) and property city (as zone).
   */
  async findForTicket(ticketId: string) {
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      include: {
        category: { select: { name: true } },
        property: { select: { city: true } },
      },
    });

    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }

    /* El rubro y la zona ordenan la lista, no la recortan: filtrando por los
       dos a la vez alcanzaba con que la zona estuviera cargada con otro nivel
       de detalle (barrio vs. ciudad) para dejar al usuario sin ningun
       proveedor y sin forma de asignar. */
    const providers = await this.prisma.client.person.findMany({
      where: {
        isActive: true,
        providerProfile: { is: { isActive: true } },
      },
      include: {
        providerProfile: true,
        roles: true,
      },
      orderBy: { lastName: 'asc' },
    });

    const rubro = ticket.category?.name;
    const city = ticket.property?.city;

    const score = (person: (typeof providers)[number]) => {
      const profile: any = person.providerProfile;
      const rubros: string[] = profile?.rubros ?? [];
      const zones: string[] = profile?.coverageZones ?? [];
      const matchesRubro = rubro ? rubros.includes(rubro) : false;
      const matchesZone = city ? zones.includes(city) : false;
      return (matchesRubro ? 2 : 0) + (matchesZone ? 1 : 0);
    };

    return [...providers].sort((a, b) => {
      const diff = score(b) - score(a);
      return diff !== 0 ? diff : a.lastName.localeCompare(b.lastName);
    });
  }
}
