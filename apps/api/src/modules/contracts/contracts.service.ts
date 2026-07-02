import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateContractSchema,
  UpdateContractSchema,
  ContractFilterSchema,
  ContractStatus,
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
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = ContractFilterSchema.parse(query);
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

    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.adjustmentType) where.adjustmentType = filters.adjustmentType;

    // Person filter: find contracts linked to this person
    if (filters.personId) {
      where.persons = { some: { personId: filters.personId } };
    }

    // Date range filters
    if (filters.startDateFrom || filters.startDateTo) {
      where.startDate = {};
      if (filters.startDateFrom) where.startDate.gte = new Date(filters.startDateFrom);
      if (filters.startDateTo) where.startDate.lte = new Date(filters.startDateTo);
    }
    if (filters.endDateFrom || filters.endDateTo) {
      where.endDate = {};
      if (filters.endDateFrom) where.endDate.gte = new Date(filters.endDateFrom);
      if (filters.endDateTo) where.endDate.lte = new Date(filters.endDateTo);
    }

    // Guarantee expiry filter: contracts with guarantees expiring within N days
    if (filters.guaranteeExpiringWithinDays) {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() + filters.guaranteeExpiringWithinDays);
      where.guarantees = {
        some: {
          endDate: { lte: thresholdDate },
          status: 'Vigente',
        },
      };
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.contract.findMany({
        where,
        include: {
          persons: { include: { person: true } },
          guarantees: true,
          property: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.contract.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ─────────────────────────────────────────

  async findOne(id: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id },
      include: {
        persons: { include: { person: true } },
        guarantees: true,
        property: true,
      },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    return contract;
  }

  // ─── Create ─────────────────────────────────────────

  async create(data: unknown) {
    let validated: any;
    try {
      validated = CreateContractSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid contract data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Validate property exists
    const property = await this.prisma.client.property.findFirst({
      where: { id: validated.propertyId },
    });
    if (!property) {
      throw new BadRequestException({
        error: 'PROPERTY_NOT_FOUND',
        message: `Property ${validated.propertyId} not found`,
      });
    }

    // Validate persons exist and have correct roles
    for (const cp of validated.persons) {
      const person = await this.prisma.client.person.findFirst({
        where: { id: cp.personId },
        include: { roles: true },
      });

      if (!person) {
        throw new BadRequestException({
          error: 'PERSON_NOT_FOUND',
          message: `Person ${cp.personId} not found`,
        });
      }

      const hasRole = person.roles.some(
        (r: any) => r.role === cp.role,
      );
      if (!hasRole) {
        throw new BadRequestException({
          error: 'INVALID_PERSON_ROLE',
          message: `Person ${cp.personId} does not have ${cp.role} role assignment`,
        });
      }
    }

    // Create contract + nested persons + guarantees in a transaction
    const contract = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.contract.create({
        data: {
          tenantId,
          propertyId: validated.propertyId,
          contractType: validated.contractType,
          status: validated.status,
          startDate: new Date(validated.startDate),
          endDate: new Date(validated.endDate),
          rentAmount: validated.rentAmount,
          rentCurrency: validated.rentCurrency,
          depositAmount: validated.depositAmount ?? null,
          depositCurrency: validated.depositCurrency ?? null,
          adjustmentType: validated.adjustmentType,
          adjustmentPeriod: validated.adjustmentPeriod,
          customAdjustmentPct: validated.customAdjustmentPct ?? null,
          notes: validated.notes ?? null,
        },
      });

      // Create contract persons
      for (const cp of validated.persons) {
        await tx.contractPerson.create({
          data: {
            tenantId,
            contractId: created.id,
            personId: cp.personId,
            role: cp.role,
          },
        });
      }

      // Create guarantees
      for (const g of validated.guarantees) {
        await tx.contractGuarantee.create({
          data: {
            tenantId,
            contractId: created.id,
            type: g.type,
            status: g.status,
            description: g.description ?? null,
            amount: g.amount ?? null,
            currency: g.currency ?? null,
            issuer: g.issuer ?? null,
            policyNumber: g.policyNumber ?? null,
            startDate: g.startDate ? new Date(g.startDate) : null,
            endDate: g.endDate ? new Date(g.endDate) : null,
          },
        });
      }

      return created;
    });

    // Fetch full contract with relations
    const full = await this.findOne(contract.id);

    this.logger.log('Created contract', {
      contractId: contract.id,
      tenantId,
      adjustmentType: validated.adjustmentType,
      personsCount: validated.persons.length,
      guaranteesCount: validated.guarantees.length,
    });

    return full;
  }

  // ─── Update ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdateContractSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid contract data',
          details: err.errors,
        });
      }
      throw err;
    }

    const existing = await this.prisma.client.contract.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    await this.prisma.client.contract.update({
      where: { id },
      data: validated,
    });

    this.logger.log('Updated contract', {
      contractId: id,
      tenantId,
      fieldsUpdated: Object.keys(validated),
    });

    return this.findOne(id);
  }

  // ─── Terminate ──────────────────────────────────────

  async terminate(id: string) {
    const existing = await this.prisma.client.contract.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    await this.prisma.client.contract.update({
      where: { id },
      data: {
        status: ContractStatus.Rescindido,
        isActive: false,
      },
    });

    const tenantId = this.tenantContext.getTenantId()!;
    this.logger.log('Terminated contract', {
      contractId: id,
      tenantId,
    });

    return this.findOne(id);
  }
}
