import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantTier,
} from '@realfy/shared';
import type { CreateTenantInput, UpdateTenantInput } from '@realfy/shared';
import { DEFAULT_PENALTY_CONFIG, PenaltyConfig } from './penalty-config.types';
import { UpdatePenaltyConfigDto } from './dto/update-penalty-config.dto';

/**
 * Checks if an error is a Zod validation error.
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

/**
 * Turns a display name into a URL-safe slug root: lowercase, accents stripped,
 * runs of non-alphanumeric characters collapsed to a single hyphen.
 */
function slugify(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.length >= 3 ? normalized.slice(0, 60) : 'inmobiliaria';
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Create a new tenant (inmobiliaria).
   * Called during onboarding after the user has registered.
   * Tier defaults to Professional (trial).
   */
  async create(data: unknown) {
    let validated: CreateTenantInput;
    try {
      validated = CreateTenantSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid tenant data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Bypass tenant filter — we're creating a new tenant
    this.tenantContext.setBypassTenantFilter(true);
    try {
      const slug = await this._resolveUniqueSlug(validated.slug ?? validated.name);

      const tenant = await this.prisma.baseClient.tenant.create({
        data: {
          name: validated.name,
          slug,
          cuit: validated.cuit,
          province: validated.province,
          timezone: validated.timezone ?? 'America/Buenos_Aires',
          currency: validated.currency ?? 'ARS',
          tier: validated.tier ?? TenantTier.Professional,
          brandPrimary: validated.brandPrimary,
          brandSecondary: validated.brandSecondary,
          logoUrl: validated.logoUrl,
        },
      });

      this.logger.log(`Tenant created: id=${tenant.id} name=${tenant.name} slug=${tenant.slug}`);
      return tenant;
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Resolves a unique tenant slug from a candidate base value (either the
   * caller-supplied slug or the tenant name). Appends a numeric suffix on
   * collision — "acme", "acme-2", "acme-3"...
   */
  private async _resolveUniqueSlug(base: string): Promise<string> {
    const root = slugify(base);
    let candidate = root;
    let suffix = 1;

    while (
      await this.prisma.baseClient.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      })
    ) {
      suffix += 1;
      candidate = `${root}-${suffix}`;
    }

    return candidate;
  }

  /**
   * Update the current user's tenant (branding, settings).
   * Only updates own tenant — enforced by Prisma Extension.
   */
  async update(id: string, data: unknown) {
    let validated: UpdateTenantInput;
    try {
      validated = UpdateTenantSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid tenant data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId();
    if (tenantId !== id) {
      throw new ForbiddenException({
        error: 'TENANT_CONTEXT_REQUIRED',
        message: 'Cannot update a tenant that is not your own',
      });
    }

    if (validated.slug) {
      const taken = await this.prisma.baseClient.tenant.findFirst({
        where: { slug: validated.slug, NOT: { id } },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException({
          error: 'SLUG_ALREADY_TAKEN',
          message: `Slug "${validated.slug}" is already in use`,
        });
      }
    }

    const tenant = await this.prisma.client.tenant.update({
      where: { id },
      data: validated,
    });

    this.logger.log(`Tenant updated: id=${tenant.id}`);
    return tenant;
  }

  /**
   * Get the current user's tenant with full details.
   */
  async findMine() {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException({
        error: 'TENANT_CONTEXT_REQUIRED',
        message: 'Tenant context is required',
      });
    }

    return this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });
  }

  /**
   * Get the penalty configuration for a tenant.
   * Returns DEFAULT_PENALTY_CONFIG if no config has been set.
   */
  async getPenaltyConfig(tenantId: string): Promise<PenaltyConfig> {
    this.tenantContext.setBypassTenantFilter(true);
    try {
      const tenant = await this.prisma.baseClient.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        throw new NotFoundException({
          error: 'TENANT_NOT_FOUND',
          message: `Tenant ${tenantId} not found`,
        });
      }

      const config = (tenant as any).penaltyConfig;
      return config ?? DEFAULT_PENALTY_CONFIG;
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Update the penalty configuration for a tenant.
   */
  async updatePenaltyConfig(
    tenantId: string,
    dto: UpdatePenaltyConfigDto,
  ): Promise<PenaltyConfig> {
    this.tenantContext.setBypassTenantFilter(true);
    try {
      const updated = await this.prisma.baseClient.tenant.update({
        where: { id: tenantId },
        data: { penaltyConfig: dto as any },
      });

      return (updated as any).penaltyConfig as PenaltyConfig;
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }
}
