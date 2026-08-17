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
  AdjustmentType,
  AdjustmentPeriod,
  ContractStatus,
  ScheduleStatus,
  IndexType,
  calculateAdjustment,
} from '@realfy/shared';
import type { AdjustmentParams } from '@realfy/shared';
import Decimal from 'decimal.js';
import { ContractClosureService } from '../ai/contract-closure.service';
import { isClosedStatus } from '../ai/contract-closure';

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

/**
 * Returns the number of months between adjustment periods.
 */
function periodToMonths(period: AdjustmentPeriod): number {
  switch (period) {
    case AdjustmentPeriod.Mensual:
      return 1;
    case AdjustmentPeriod.Bimestral:
      return 2;
    case AdjustmentPeriod.Trimestral:
      return 3;
    case AdjustmentPeriod.Cuatrimestral:
      return 4;
    case AdjustmentPeriod.Semestral:
      return 6;
    case AdjustmentPeriod.Anual:
      return 12;
    default:
      return 3; // fallback to trimestral
  }
}

/**
 * Adds N months to a Date.
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly closureSummaries: ContractClosureService,
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
        adjustments: { orderBy: { periodNumber: 'asc' } },
        schedules: { orderBy: { periodNumber: 'asc' } },
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

    // Generate adjustment schedule entries
    const scheduleEntries = this.generateScheduleEntries(
      new Date(validated.startDate),
      new Date(validated.endDate),
      validated.adjustmentPeriod as AdjustmentPeriod,
    );

    // Create contract + nested persons + guarantees + schedules in a transaction
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

      // Create adjustment schedule entries
      for (const entry of scheduleEntries) {
        await tx.adjustmentSchedule.create({
          data: {
            tenantId,
            contractId: created.id,
            nextAdjustmentDate: entry.date,
            periodNumber: entry.periodNumber,
            status: ScheduleStatus.Pending,
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
      schedulesCount: scheduleEntries.length,
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

    // If dates or adjustment config changed, recalculate schedule
    const datesChanged =
      (validated.endDate && new Date(validated.endDate).getTime() !== existing.endDate.getTime()) ||
      (validated.adjustmentPeriod && validated.adjustmentPeriod !== existing.adjustmentPeriod);

    await this.prisma.client.contract.update({
      where: { id },
      data: validated,
    });

    if (datesChanged) {
      // Delete pending schedules and regenerate
      await this.prisma.client.adjustmentSchedule.deleteMany({
        where: {
          contractId: id,
          status: ScheduleStatus.Pending,
        },
      });

      const endDate = validated.endDate ? new Date(validated.endDate) : existing.endDate;
      const period = (validated.adjustmentPeriod ?? existing.adjustmentPeriod) as AdjustmentPeriod;

      // Get the highest applied/calculated period number
      const lastApplied = await this.prisma.client.adjustmentSchedule.findFirst({
        where: {
          contractId: id,
          status: { not: ScheduleStatus.Pending },
        },
        orderBy: { periodNumber: 'desc' },
      });

      const startPeriod = lastApplied ? lastApplied.periodNumber + 1 : 1;
      const startFrom = lastApplied
        ? addMonths(lastApplied.nextAdjustmentDate, periodToMonths(period))
        : addMonths(existing.startDate, periodToMonths(period));

      const newEntries = this.generateScheduleEntriesFrom(
        startFrom,
        endDate,
        period,
        startPeriod,
      );

      for (const entry of newEntries) {
        await this.prisma.client.adjustmentSchedule.create({
          data: {
            tenantId,
            contractId: id,
            nextAdjustmentDate: entry.date,
            periodNumber: entry.periodNumber,
            status: ScheduleStatus.Pending,
          },
        });
      }
    }

    this.logger.log('Updated contract', {
      contractId: id,
      tenantId,
      fieldsUpdated: Object.keys(validated),
      schedulesRecalculated: datesChanged,
    });

    // El contrato acaba de pasar a un estado de cierre: se resume la gestión.
    // Si el resumen falla, el cambio de estado ya quedó hecho igual.
    const justClosed =
      validated.status !== undefined &&
      isClosedStatus(validated.status) &&
      !isClosedStatus(existing.status);
    if (justClosed) {
      await this.closureSummaries.generateOnClosure(tenantId, id);
    }

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

    // Mark all pending schedules as Skipped
    await this.prisma.client.adjustmentSchedule.updateMany({
      where: {
        contractId: id,
        status: ScheduleStatus.Pending,
      },
      data: { status: ScheduleStatus.Skipped },
    });

    const tenantId = this.tenantContext.getTenantId()!;
    this.logger.log('Terminated contract', {
      contractId: id,
      tenantId,
    });

    await this.closureSummaries.generateOnClosure(tenantId, id);

    return this.findOne(id);
  }

  // ─── Calculate Adjustment ───────────────────────────

  async calculateAdjustment(contractId: string, scheduleId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      include: { adjustments: { orderBy: { periodNumber: 'desc' }, take: 1 } },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    const schedule = await this.prisma.client.adjustmentSchedule.findFirst({
      where: { id: scheduleId, contractId },
    });

    if (!schedule) {
      throw new NotFoundException({
        error: 'SCHEDULE_NOT_FOUND',
        message: 'Adjustment schedule entry not found',
      });
    }

    if (schedule.status !== ScheduleStatus.Pending) {
      throw new BadRequestException({
        error: 'SCHEDULE_NOT_PENDING',
        message: `Schedule is already ${schedule.status}`,
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const baseRent = new Decimal(contract.rentAmount.toString());
    const adjustmentType = contract.adjustmentType as AdjustmentType;

    let params: AdjustmentParams;

    // Build params based on adjustment type, loading index data from DB
    switch (adjustmentType) {
      case AdjustmentType.IPC: {
        const indexData = await this.loadIndexData(
          tenantId,
          IndexType.IPC,
          contract.startDate,
          schedule.nextAdjustmentDate,
        );
        if (indexData.length === 0) {
          throw new BadRequestException({
            error: 'MISSING_INDEX_DATA',
            message: 'No IPC index data found for the adjustment period',
            indexType: IndexType.IPC,
            periodStart: contract.startDate,
            periodEnd: schedule.nextAdjustmentDate,
          });
        }
        params = {
          type: AdjustmentType.IPC,
          monthlyValues: indexData.map((d: any) => new Decimal(d.value.toString())),
          baseRent,
        };
        break;
      }
      case AdjustmentType.ICL: {
        const indexData = await this.loadIndexData(
          tenantId,
          IndexType.ICL,
          contract.startDate,
          schedule.nextAdjustmentDate,
        );
        if (indexData.length < 2) {
          throw new BadRequestException({
            error: 'MISSING_INDEX_DATA',
            message: 'ICL requires at least start and end index values',
            indexType: IndexType.ICL,
            periodStart: contract.startDate,
            periodEnd: schedule.nextAdjustmentDate,
          });
        }
        params = {
          type: AdjustmentType.ICL,
          startValue: new Decimal(indexData[0].value.toString()),
          endValue: new Decimal(indexData[indexData.length - 1].value.toString()),
          baseRent,
        };
        break;
      }
      case AdjustmentType.CCP: {
        const cvsData = await this.loadIndexData(
          tenantId,
          IndexType.CVS,
          contract.startDate,
          schedule.nextAdjustmentDate,
        );
        const cerData = await this.loadIndexData(
          tenantId,
          IndexType.CER,
          contract.startDate,
          schedule.nextAdjustmentDate,
        );
        if (cvsData.length === 0 || cerData.length === 0) {
          throw new BadRequestException({
            error: 'MISSING_INDEX_DATA',
            message: 'CCP requires both CVS and CER index data',
            indexType: 'CVS+CER',
            periodStart: contract.startDate,
            periodEnd: schedule.nextAdjustmentDate,
          });
        }
        const minLen = Math.min(cvsData.length, cerData.length);
        params = {
          type: AdjustmentType.CCP,
          cvsPcts: cvsData.slice(0, minLen).map((d: any) => new Decimal(d.value.toString())),
          cerPcts: cerData.slice(0, minLen).map((d: any) => new Decimal(d.value.toString())),
          baseRent,
        };
        break;
      }
      case AdjustmentType.FixedPercent: {
        if (!contract.customAdjustmentPct) {
          throw new BadRequestException({
            error: 'MISSING_ADJUSTMENT_PCT',
            message: 'Contract has no customAdjustmentPct set for FixedPercent type',
          });
        }
        params = {
          type: AdjustmentType.FixedPercent,
          percentage: new Decimal(contract.customAdjustmentPct.toString()),
          baseRent,
        };
        break;
      }
      case AdjustmentType.Custom: {
        if (!contract.customAdjustmentPct) {
          throw new BadRequestException({
            error: 'MISSING_ADJUSTMENT_PCT',
            message: 'Contract has no customAdjustmentPct set for Custom type',
          });
        }
        params = {
          type: AdjustmentType.Custom,
          percentage: new Decimal(contract.customAdjustmentPct.toString()),
          baseRent,
        };
        break;
      }
      default:
        throw new BadRequestException({
          error: 'UNKNOWN_ADJUSTMENT_TYPE',
          message: `Unknown adjustment type: ${adjustmentType}`,
        });
    }

    const result = calculateAdjustment(params);

    // Create adjustment record
    const adjustment = await this.prisma.client.contractAdjustment.create({
      data: {
        tenantId,
        contractId,
        periodNumber: schedule.periodNumber,
        adjustmentDate: schedule.nextAdjustmentDate,
        previousAmount: contract.rentAmount,
        newAmount: result.newRent.toString(),
        percentage: result.percentage.toDecimalPlaces(4).toString(),
        currency: contract.rentCurrency,
        indexType: adjustmentType,
        indexValues: params as any,
        calculatedAt: new Date(),
      },
    });

    // Update schedule status to Calculated
    await this.prisma.client.adjustmentSchedule.update({
      where: { id: scheduleId },
      data: { status: ScheduleStatus.Calculated },
    });

    this.logger.log('Calculated adjustment', {
      contractId,
      tenantId,
      adjustmentType,
      periodNumber: schedule.periodNumber,
      previousAmount: contract.rentAmount.toString(),
      newAmount: result.newRent.toString(),
      percentage: result.percentage.toDecimalPlaces(4).toString(),
    });

    return adjustment;
  }

  // ─── Apply Adjustment ───────────────────────────────

  async applyAdjustment(contractId: string, adjustmentId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    const adjustment = await this.prisma.client.contractAdjustment.findFirst({
      where: { id: adjustmentId, contractId },
    });

    if (!adjustment) {
      throw new NotFoundException({
        error: 'ADJUSTMENT_NOT_FOUND',
        message: 'Adjustment not found',
      });
    }

    if (adjustment.appliedAt) {
      throw new BadRequestException({
        error: 'ADJUSTMENT_ALREADY_APPLIED',
        message: 'Adjustment has already been applied',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Mark adjustment as applied and update contract rentAmount
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.contractAdjustment.update({
        where: { id: adjustmentId },
        data: { appliedAt: new Date() },
      });

      await tx.contract.update({
        where: { id: contractId },
        data: { rentAmount: adjustment.newAmount },
      });

      // Update the corresponding schedule to Applied
      await tx.adjustmentSchedule.updateMany({
        where: {
          contractId,
          periodNumber: adjustment.periodNumber,
        },
        data: { status: ScheduleStatus.Applied },
      });
    });

    this.logger.log('Applied adjustment', {
      contractId,
      tenantId,
      adjustmentId,
      newRentAmount: adjustment.newAmount.toString(),
    });

    return this.findOne(contractId);
  }

  // ─── List Adjustments ───────────────────────────────

  async findAdjustments(contractId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    return this.prisma.client.contractAdjustment.findMany({
      where: { contractId },
      orderBy: { periodNumber: 'asc' },
    });
  }

  // ─── Helpers ────────────────────────────────────────

  private generateScheduleEntries(
    startDate: Date,
    endDate: Date,
    period: AdjustmentPeriod,
  ): { date: Date; periodNumber: number }[] {
    return this.generateScheduleEntriesFrom(
      addMonths(startDate, periodToMonths(period)),
      endDate,
      period,
      1,
    );
  }

  private generateScheduleEntriesFrom(
    from: Date,
    endDate: Date,
    period: AdjustmentPeriod,
    startPeriod: number,
  ): { date: Date; periodNumber: number }[] {
    const entries: { date: Date; periodNumber: number }[] = [];
    const months = periodToMonths(period);
    let currentDate = new Date(from);
    let periodNumber = startPeriod;

    while (currentDate <= endDate) {
      entries.push({ date: new Date(currentDate), periodNumber });
      currentDate = addMonths(currentDate, months);
      periodNumber++;
    }

    return entries;
  }

  private async loadIndexData(
    tenantId: string,
    indexType: IndexType,
    startDate: Date,
    endDate: Date,
  ) {
    return this.prisma.client.indexData.findMany({
      where: {
        indexType: indexType as any,
        period: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { period: 'asc' },
    });
  }
}
