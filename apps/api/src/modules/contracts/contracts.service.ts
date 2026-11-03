import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractAdjustmentService } from '../index-data/contract-adjustment.service';
import { resolveAdjustmentWindow } from '../index-data/adjustment-window';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateContractSchema,
  UpdateContractSchema,
  ContractFilterSchema,
  AdjustmentType,
  AdjustmentPeriod,
  AdjustmentBase,
  ContractPeriodKind,
  ContractStatus,
  ContractType,
  Currency,
  DepositHolder,
  DepositRefundRule,
  PaymentFlow,
  PersonRole,
  PropertyOperationType,
  PropertyState,
  ScheduleStatus,
  calculateAdjustment,
  addMonthsClamped,
  periodToMonths,
  findTransitionPath,
  contractMachine,
  isClosedStatus,
  splitEqualPct,
  findInvalidShareDates,
} from '@realfy/shared';
import type { InvalidShareDate } from '@realfy/shared';
import { assertTransition } from '../../common/errors/assert-transition';
import { ContractClosureService } from '../ai/contract-closure.service';
import { parseOrThrow } from '../../common/validation/zod';
import { rethrowExternalRefConflict } from '../../common/validation/external-ref';
import { ensureRole } from '../persons/person-roles.service';
import { getApoderadosAt } from './contract-parties';
import { assertLessorRefs } from './lessor-rules';
import { getEffectiveEndDate } from './contract-terms';
import {
  occupiesRentalOperation,
  occupyRentalOperation,
  releaseRentalOperation,
} from './property-occupancy';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';

/**
 * Motivo por el que un contrato no se puede activar. `code` es estable y es lo
 * que la web traduce; el resto es contexto para armar el mensaje.
 */
export interface ActivationProblem {
  code:
    | 'PROPERTY_NOT_FOUND'
    | 'PROPERTY_INACTIVE'
    | 'MISSING_INQUILINO'
    | 'LESSOR_SHARES_INVALID'
    | 'INVALID_DATES'
    | 'OVERLAPPING_CONTRACT'
    | 'RENTAL_OPERATION_ARCHIVED';
  contractId?: string;
  startDate?: Date;
  endDate?: Date;
  /** Para LESSOR_SHARES_INVALID: fechas en que los locadores vigentes no suman 100 %. */
  invalidDates?: InvalidShareDate[];
}

/** Datos del contrato que intervienen en la activación. */
export interface ActivationCandidate {
  id?: string;
  propertyId: string;
  contractType: string;
  startDate: Date;
  endDate: Date;
  /** Roles de las partes que no son locadores (inquilino, garante...). */
  roles: string[];
}

/** Los contratos que no son de venta necesitan inquilino además de locadores. */
function requiresInquilino(contractType: string): boolean {
  return contractType !== ContractType.Venta;
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly closureSummaries: ContractClosureService,
    private readonly adjustments: ContractAdjustmentService,
    private readonly operationalDefaults: OperationalDefaultsService,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    const filters: any = parseOrThrow(ContractFilterSchema, query, 'Invalid filter parameters');

    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.externalRef) where.externalRef = filters.externalRef;
    if (filters.adjustmentType) where.adjustmentType = filters.adjustmentType;

    // Person filter: find contracts linked to this person
    if (filters.personId) {
      where.OR = [
        { persons: { some: { personId: filters.personId } } },
        { lessors: { some: { personId: filters.personId } } },
      ];
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
        lessors: {
          include: { person: true, payee: true, bankAccount: true },
          orderBy: [{ validFrom: 'asc' }, { payoutPct: 'desc' }, { id: 'asc' }],
        },
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

    const apoderados = await getApoderadosAt(this.prisma.client, contract, new Date());
    return { ...contract, apoderados };
  }

  // ─── Create ─────────────────────────────────────────

  async create(data: unknown) {
    const validated: any = parseOrThrow(CreateContractSchema, data, 'Invalid contract data');

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

    // Los propietarios que vienen en `persons` son locadores: no hacen falta
    // en `ContractPerson`, y no necesitan tener el rol para firmar (se les pone).
    const ownerEntries = validated.persons.filter(
      (cp: { role: string }) => cp.role === PersonRole.Propietario,
    );
    const otherEntries = validated.persons.filter(
      (cp: { role: string }) => cp.role !== PersonRole.Propietario,
    );
    const startDate = new Date(validated.startDate);
    const lessorRows: Array<{
      personId: string;
      capacity: string;
      payoutPct: string;
      payeePersonId: string | null;
      bankAccountId: string | null;
      validFrom: Date;
      validTo: Date | null;
      needsReview: boolean;
    }> =
      validated.lessors.length > 0
        ? validated.lessors.map((l: any) => ({
            personId: l.personId,
            capacity: l.capacity,
            payoutPct: l.payoutPct,
            payeePersonId: l.payeePersonId ?? null,
            bankAccountId: l.bankAccountId ?? null,
            validFrom: l.validFrom ? new Date(l.validFrom) : startDate,
            validTo: l.validTo ? new Date(l.validTo) : null,
            needsReview: false,
          }))
        : (() => {
            const shares = splitEqualPct(Math.max(ownerEntries.length, 1));
            return ownerEntries.map((cp: { personId: string }, i: number) => ({
              personId: cp.personId,
              capacity: 'Propietario',
              payoutPct: shares[i],
              payeePersonId: null,
              bankAccountId: null,
              validFrom: startDate,
              validTo: null,
              needsReview: ownerEntries.length > 1,
            }));
          })();

    for (const row of lessorRows) {
      await assertLessorRefs(this.prisma.client, row, {
        propertyId: validated.propertyId,
        at: row.validFrom,
      });
    }

    // Validate persons exist and have correct roles
    for (const cp of otherEntries) {
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

    // Valores por defecto de la inmobiliaria: de ahí parten las reglas del contrato.
    const defaults = await this.operationalDefaults.get(tenantId);

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
          externalRef: validated.externalRef ?? null,
        },
      });

      // Período original y primera versión de las reglas: el contrato nunca
      // queda sin ellas (defecto -> contrato).
      await tx.contractPeriod.create({
        data: {
          tenantId,
          contractId: created.id,
          seq: 1,
          kind: ContractPeriodKind.Original,
          startDate: new Date(validated.startDate),
          endDate: new Date(validated.endDate),
          initialRent: validated.rentAmount,
        },
      });
      await tx.contractTermsVersion.create({
        data: {
          tenantId,
          contractId: created.id,
          validFrom: new Date(validated.startDate),
          adjustmentType: validated.adjustmentType,
          adjustmentPeriod: validated.adjustmentPeriod,
          adjustmentBase: AdjustmentBase.Vigente,
          indexLagMonths: defaults.ipcLagMonths,
          customPct: validated.customAdjustmentPct ?? null,
          dueDay: defaults.dueDay,
          paymentFlow: PaymentFlow.Partido,
          // Convenciones de liquidación: las pactadas en el alta o, si no, las de la inmobiliaria.
          prorationMode: validated.liquidationRules?.prorationMode ?? defaults.prorationMode,
          midMonthAdjustmentMode:
            validated.liquidationRules?.midMonthAdjustmentMode ?? defaults.midMonthAdjustmentMode,
          firstDueMode: validated.liquidationRules?.firstDueMode ?? defaults.firstDueMode,
          fixedDiscountProration:
            validated.liquidationRules?.fixedDiscountProration ?? defaults.fixedDiscountProration,
          // Ajuste aplicado después de emitir el mes: el pactado o el de la inmobiliaria (DEF-134).
          lateAdjustmentBilling:
            validated.liquidationRules?.lateAdjustmentBilling ?? defaults.lateAdjustmentBilling,
          // Anticipo del centro de carga: umbral propio (null = el de la inmobiliaria) y su base.
          upfrontThresholdFees: validated.liquidationRules?.upfrontThresholdFees ?? null,
          upfrontBasis: validated.liquidationRules?.upfrontBasis ?? defaults.upfrontBasis,
          // Qué debe el locador que cobra directamente: null = el de la inmobiliaria.
          lessorDirectOwes: validated.liquidationRules?.lessorDirectOwes ?? null,
          // Reparaciones: límite propio sin consultar al locador (null = el de la inmobiliaria).
          repairPreauthLimitAmount: validated.liquidationRules?.repairPreauthLimitAmount ?? null,
          repairPreauthLimitCurrency: validated.liquidationRules?.repairPreauthLimitAmount
            ? (validated.liquidationRules?.repairPreauthLimitCurrency ?? 'ARS')
            : null,
        },
      });

      // Depósito declarado en el alta: nace pendiente, en una cuota al inicio, con la
      // regla habitual (pesos actualizado en pesos, la misma moneda en los demás).
      if (validated.depositAmount && Number(validated.depositAmount) > 0) {
        const depositCurrency = validated.depositCurrency ?? validated.rentCurrency;
        const heldBy = defaults.deposits.defaultHeldBy;
        const deposit = await tx.contractDeposit.create({
          data: {
            tenantId,
            contractId: created.id,
            amount: validated.depositAmount,
            currency: depositCurrency,
            heldBy,
            heldByPersonId: heldBy === DepositHolder.Locador ? (lessorRows[0]?.personId ?? null) : null,
            refundRule:
              depositCurrency === Currency.ARS ? DepositRefundRule.PesosActualizado : DepositRefundRule.MismaMoneda,
            refundDueDays: defaults.deposits.refundDueDays,
          },
        });
        await tx.contractDepositInstallment.create({
          data: {
            tenantId,
            depositId: deposit.id,
            number: 1,
            dueDate: new Date(validated.startDate),
            amount: validated.depositAmount,
          },
        });
      }

      // Create contract persons (inquilino, garante...) and lessors
      for (const cp of otherEntries) {
        await tx.contractPerson.create({
          data: {
            tenantId,
            contractId: created.id,
            personId: cp.personId,
            role: cp.role,
          },
        });
      }
      for (const row of lessorRows) {
        await tx.contractLessor.create({
          data: { tenantId, contractId: created.id, ...row },
        });
        await ensureRole(tx, row.personId, PersonRole.Propietario);
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

      // Crear un contrato ya activo es crearlo y activarlo: pasa por las mismas
      // reglas y ocupa la propiedad. Si algo falla, no queda nada creado.
      if (validated.status === ContractStatus.Activo) {
        const candidate: ActivationCandidate = {
          id: created.id,
          propertyId: validated.propertyId,
          contractType: validated.contractType,
          startDate: new Date(validated.startDate),
          endDate: new Date(validated.endDate),
          roles: otherEntries.map((p: { role: string }) => p.role),
        };
        await this.assertActivatable(tx, candidate);
        await this.occupyProperty(tx, tenantId, candidate);
      }

      return created;
    }).catch((err: unknown) => rethrowExternalRefConflict(err, 'contract'));

    // Fetch full contract with relations
    const full = await this.findOne(contract.id);

    this.logger.log('Created contract', {
      contractId: contract.id,
      tenantId,
      adjustmentType: validated.adjustmentType,
      personsCount: validated.persons.length,
      lessorsCount: lessorRows.length,
      guaranteesCount: validated.guarantees.length,
      schedulesCount: scheduleEntries.length,
    });

    return full;
  }

  // ─── Update ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    const { liquidationRules, ...validated }: any = parseOrThrow(
      UpdateContractSchema,
      data,
      'Invalid contract data',
    );
    const touchesConventions = !!liquidationRules && Object.keys(liquidationRules).length > 0;

    const existing = await this.prisma.client.contract.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    if (validated.endDate && new Date(validated.endDate).getTime() <= existing.startDate.getTime()) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'endDate must be after startDate',
      });
    }

    // Fin real o prórroga de palabra: no puede ser anterior al inicio.
    if (
      validated.actualEndDate &&
      new Date(validated.actualEndDate).getTime() < existing.startDate.getTime()
    ) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'actualEndDate must not be before startDate',
      });
    }

    // Las reglas de ajuste de un contrato con convenios cambian por convenio:
    // pisar las columnas dejaría la historia de versiones desactualizada.
    const touchesRules = this.touchesAdjustmentRules(validated, existing);
    if (touchesRules || touchesConventions) {
      const versions = await this.prisma.client.contractTermsVersion.count({
        where: { contractId: id },
      });
      if (versions > 1) {
        throw new ConflictException({
          error: 'RULES_CHANGE_REQUIRES_AGREEMENT',
          message: 'This contract has rule versions: change the rules with an agreement',
        });
      }
    }

    const statusChanges =
      validated.status !== undefined && validated.status !== existing.status;
    if (statusChanges) {
      // La activación tiene sus propias validaciones y efectos: no se hace por PATCH.
      if (validated.status === ContractStatus.Activo) {
        throw new BadRequestException({
          error: 'ACTIVATION_REQUIRED',
          message: 'Use POST /contracts/:id/activate to activate a contract',
        });
      }
      this.assertTransition(existing.status, validated.status);
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // If dates or adjustment config changed, recalculate schedule
    const actualEndChanged =
      validated.actualEndDate !== undefined &&
      (validated.actualEndDate === null
        ? existing.actualEndDate !== null
        : existing.actualEndDate === null ||
          new Date(validated.actualEndDate).getTime() !== existing.actualEndDate.getTime());
    const datesChanged =
      (validated.endDate && new Date(validated.endDate).getTime() !== existing.endDate.getTime()) ||
      actualEndChanged ||
      (validated.adjustmentPeriod && validated.adjustmentPeriod !== existing.adjustmentPeriod);

    // Fin efectivo con los cambios pedidos: lo que cuenta para pisarse con otro alquiler.
    const newEffectiveEnd = getEffectiveEndDate({
      endDate: validated.endDate ? new Date(validated.endDate) : existing.endDate,
      actualEndDate:
        validated.actualEndDate === undefined
          ? existing.actualEndDate
          : validated.actualEndDate
            ? new Date(validated.actualEndDate)
            : null,
    });

    // El contrato pasa a un estado de cierre: se registra la fecha en la misma
    // transición, para no tener que deducirla después.
    const justClosed =
      validated.status !== undefined &&
      isClosedStatus(validated.status) &&
      !isClosedStatus(existing.status);

    // Un contrato activo que deja de estarlo libera la propiedad.
    const leavesActive =
      statusChanges && existing.status === ContractStatus.Activo;
    // Extender un contrato activo no puede pisar a otro alquiler activo.
    const extendsActive =
      !statusChanges &&
      existing.status === ContractStatus.Activo &&
      (validated.endDate !== undefined || actualEndChanged) &&
      occupiesRentalOperation(existing.contractType);

    await this.prisma.client.$transaction(async (tx: any) => {
      if (extendsActive) {
        await this.assertNoOverlap(tx, {
          id,
          propertyId: existing.propertyId,
          startDate: existing.startDate,
          endDate: newEffectiveEnd,
        });
      }

      await tx.contract.update({
        where: { id },
        data: justClosed ? { ...validated, closedAt: new Date() } : validated,
      });

      if (leavesActive) {
        await this.releaseProperty(tx, existing);
      }

      await this.syncRulesAfterUpdate(tx, existing, validated, touchesRules);
      if (touchesConventions) {
        // Las convenciones de liquidación de un contrato sin convenios se corrigen en su versión inicial.
        await tx.contractTermsVersion.updateMany({
          where: { contractId: existing.id },
          data: liquidationRules,
        });
      }
    }).catch((err: unknown) => rethrowExternalRefConflict(err, 'contract'));

    if (datesChanged) {
      await this.rebuildPendingSchedule(id);
    }

    this.logger.log('Updated contract', {
      contractId: id,
      tenantId,
      fieldsUpdated: [...Object.keys(validated), ...(touchesConventions ? ['liquidationRules'] : [])],
      schedulesRecalculated: datesChanged,
    });

    if (justClosed) {
      this.summarizeClosure(tenantId, id);
    }

    return this.findOne(id);
  }

  /** El cambio pide modificar la modalidad de ajuste respecto de lo guardado. */
  private touchesAdjustmentRules(validated: any, existing: any): boolean {
    return (
      (validated.adjustmentType !== undefined && validated.adjustmentType !== existing.adjustmentType) ||
      (validated.adjustmentPeriod !== undefined &&
        validated.adjustmentPeriod !== existing.adjustmentPeriod) ||
      (validated.customAdjustmentPct !== undefined &&
        String(validated.customAdjustmentPct ?? '') !== String(existing.customAdjustmentPct ?? ''))
    );
  }

  /**
   * Mantiene período y reglas de acuerdo con la edición directa del contrato:
   * la corrección de un dato (contrato sin convenios) actualiza la versión
   * inicial; el fin pactado, el último período.
   */
  private async syncRulesAfterUpdate(
    tx: any,
    existing: any,
    validated: any,
    touchesRules: boolean,
  ): Promise<void> {
    if (touchesRules) {
      await tx.contractTermsVersion.updateMany({
        where: { contractId: existing.id },
        data: {
          ...(validated.adjustmentType !== undefined && { adjustmentType: validated.adjustmentType }),
          ...(validated.adjustmentPeriod !== undefined && {
            adjustmentPeriod: validated.adjustmentPeriod,
          }),
          ...(validated.customAdjustmentPct !== undefined && {
            customPct: validated.customAdjustmentPct ?? null,
          }),
        },
      });
    }
    if (validated.endDate) {
      const last = await tx.contractPeriod.findFirst({
        where: { contractId: existing.id },
        orderBy: { seq: 'desc' },
        select: { id: true },
      });
      if (last) {
        await tx.contractPeriod.update({
          where: { id: last.id },
          data: { endDate: new Date(validated.endDate) },
        });
      }
    }
  }

  /**
   * Rehace los ajustes pendientes del cronograma con la periodicidad y el fin
   * efectivo vigentes del contrato; los ya calculados o aplicados no se tocan.
   */
  async rebuildPendingSchedule(id: string): Promise<void> {
    const tenantId = this.tenantContext.getTenantId()!;
    const contract = await this.prisma.client.contract.findFirst({ where: { id } });
    if (!contract) return;

    await this.prisma.client.adjustmentSchedule.deleteMany({
      where: { contractId: id, status: ScheduleStatus.Pending },
    });

    // Get the highest applied/calculated period number
    const lastApplied = await this.prisma.client.adjustmentSchedule.findFirst({
      where: { contractId: id, status: { not: ScheduleStatus.Pending } },
      orderBy: { periodNumber: 'desc' },
    });

    const newEntries = this.generateScheduleEntriesFrom(
      lastApplied ? lastApplied.nextAdjustmentDate : contract.startDate,
      getEffectiveEndDate(contract),
      contract.adjustmentPeriod as AdjustmentPeriod,
      lastApplied ? lastApplied.periodNumber + 1 : 1,
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

    this.assertTransition(existing.status, ContractStatus.Rescindido);

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.contract.update({
        where: { id },
        data: {
          status: ContractStatus.Rescindido,
          isActive: false,
          closedAt: new Date(),
        },
      });

      if (existing.status === ContractStatus.Activo) {
        await this.releaseProperty(tx, existing);
      }
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

    this.summarizeClosure(tenantId, id);

    return this.findOne(id);
  }

  // ─── Activate ───────────────────────────────────────

  /**
   * Borrador → Activo. Valida que el contrato esté completo y no choque con
   * otro alquiler activo de la misma propiedad, y en la misma transacción
   * deja la operación de alquiler de la propiedad en Alquilado.
   */
  async activate(id: string) {
    const existing = await this.prisma.client.contract.findFirst({
      where: { id },
      include: { persons: true },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    // Un contrato vencido se regulariza con la prórroga de palabra o la renovación, no activándolo.
    if (existing.status === ContractStatus.Vencido) {
      throw new ConflictException({
        error: 'EXPIRED_CONTRACT_NEEDS_EXTENSION_OR_RENEWAL',
        message: 'An expired contract is reactivated by an oral extension or a renewal',
      });
    }
    this.assertTransition(existing.status, ContractStatus.Activo);

    const tenantId = this.tenantContext.getTenantId()!;
    const candidate: ActivationCandidate = {
      id,
      propertyId: existing.propertyId,
      contractType: existing.contractType,
      startDate: existing.startDate,
      endDate: getEffectiveEndDate(existing),
      roles: (existing.persons ?? []).map((p: { role: string }) => p.role),
    };

    await this.prisma.client.$transaction(async (tx: any) => {
      await this.assertActivatable(tx, candidate);
      await tx.contract.update({
        where: { id },
        data: { status: ContractStatus.Activo, isActive: true },
      });
      await this.occupyProperty(tx, tenantId, candidate);
    });

    this.logger.log('Activated contract', {
      contractId: id,
      tenantId,
      propertyId: existing.propertyId,
    });

    return this.findOne(id);
  }

  /**
   * Vencido → Activo para un contrato que en la práctica sigue corriendo. Solo
   * lo usan la prórroga de palabra y la renovación, dentro de su transacción:
   * valida la transición y que el nuevo fin efectivo no pise a otro alquiler,
   * lo vuelve a poner activo (sin fecha de cierre) y ocupa la propiedad de nuevo.
   */
  async reactivateExpired(
    tx: any,
    contract: { id: string; status: string; propertyId: string; contractType: string; startDate: Date },
    effectiveEnd: Date,
  ): Promise<void> {
    this.assertTransition(contract.status, ContractStatus.Activo);
    await this.assertNoOverlap(tx, {
      id: contract.id,
      propertyId: contract.propertyId,
      startDate: contract.startDate,
      endDate: effectiveEnd,
    });
    await tx.contract.update({
      where: { id: contract.id },
      data: { status: ContractStatus.Activo, isActive: true, closedAt: null },
    });
    await this.occupyProperty(tx, this.tenantContext.getTenantId()!, {
      ...contract,
      endDate: effectiveEnd,
      roles: [],
    });
  }

  private assertTransition(from: string, to: string): void {
    assertTransition(contractMachine, from as ContractStatus, to as ContractStatus);
  }

  /**
   * Junta todos los motivos por los que el contrato no puede quedar activo,
   * para que quien lo carga los corrija de una vez en lugar de ir
   * descubriéndolos de a uno.
   */
  private async activationProblems(
    tx: any,
    candidate: ActivationCandidate,
  ): Promise<ActivationProblem[]> {
    const problems: ActivationProblem[] = [];

    const property = await tx.property.findFirst({
      where: { id: candidate.propertyId },
    });
    if (!property) {
      problems.push({ code: 'PROPERTY_NOT_FOUND' });
    } else if (property.isActive === false) {
      problems.push({ code: 'PROPERTY_INACTIVE' });
    }

    // Los locadores vigentes tienen que sumar exactamente 100 % el día en que
    // empieza el contrato y cada vez que alguien entra o sale.
    const lessors = await tx.contractLessor.findMany({
      where: { contractId: candidate.id },
      select: { payoutPct: true, validFrom: true, validTo: true },
    });
    const invalidDates = findInvalidShareDates(
      lessors,
      candidate.startDate,
      candidate.endDate,
    );
    if (invalidDates.length > 0) {
      problems.push({ code: 'LESSOR_SHARES_INVALID', invalidDates });
    }
    if (
      requiresInquilino(candidate.contractType) &&
      !candidate.roles.includes(PersonRole.Inquilino)
    ) {
      problems.push({ code: 'MISSING_INQUILINO' });
    }

    const datesValid =
      candidate.endDate.getTime() > candidate.startDate.getTime();
    if (!datesValid) {
      problems.push({ code: 'INVALID_DATES' });
    }

    if (property && occupiesRentalOperation(candidate.contractType)) {
      if (datesValid) {
        problems.push(...(await this.overlapProblems(tx, candidate)));
      }

      const operation = await tx.propertyOperation.findFirst({
        where: {
          propertyId: candidate.propertyId,
          operationType: PropertyOperationType.Alquiler,
        },
      });
      if (
        operation &&
        findTransitionPath(
          PropertyOperationType.Alquiler,
          operation.state as PropertyState,
          PropertyState.Alquilado,
        ) === null
      ) {
        problems.push({ code: 'RENTAL_OPERATION_ARCHIVED' });
      }
    }

    return problems;
  }

  /**
   * Alquileres activos de la misma propiedad cuyas fechas se pisan con las del
   * contrato. Se pisan si uno empieza antes de que el otro termine; que uno
   * termine el mismo día en que empieza el siguiente no es pisarse.
   */
  private async overlapProblems(
    tx: any,
    candidate: Pick<ActivationCandidate, 'id' | 'propertyId' | 'startDate' | 'endDate'>,
  ): Promise<ActivationProblem[]> {
    const overlapping = await tx.contract.findMany({
      where: {
        propertyId: candidate.propertyId,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        ...(candidate.id ? { id: { not: candidate.id } } : {}),
        startDate: { lt: candidate.endDate },
        // Fin efectivo: el fin real o prórroga de palabra si lo hay, y si no el pactado.
        OR: [
          { actualEndDate: null, endDate: { gt: candidate.startDate } },
          { actualEndDate: { gt: candidate.startDate } },
        ],
      },
      select: { id: true, startDate: true, endDate: true, actualEndDate: true },
      orderBy: { startDate: 'asc' },
    });

    return overlapping.map(
      (other: { id: string; startDate: Date; endDate: Date; actualEndDate: Date | null }) => ({
        code: 'OVERLAPPING_CONTRACT' as const,
        contractId: other.id,
        startDate: other.startDate,
        endDate: getEffectiveEndDate(other),
      }),
    );
  }

  private throwNotActivatable(problems: ActivationProblem[]): never {
    throw new BadRequestException({
      error: 'CONTRACT_NOT_ACTIVATABLE',
      message: `Contract cannot be activated: ${problems.map((p) => p.code).join(', ')}`,
      problems,
    });
  }

  private async assertActivatable(
    tx: any,
    candidate: ActivationCandidate,
  ): Promise<void> {
    const problems = await this.activationProblems(tx, candidate);
    if (problems.length > 0) this.throwNotActivatable(problems);
  }

  private async assertNoOverlap(
    tx: any,
    candidate: Pick<ActivationCandidate, 'id' | 'propertyId' | 'startDate' | 'endDate'>,
  ): Promise<void> {
    const problems = await this.overlapProblems(tx, candidate);
    if (problems.length > 0) this.throwNotActivatable(problems);
  }

  /** Ocupa la operación de alquiler al activar (ver `occupyRentalOperation`). */
  private async occupyProperty(
    tx: any,
    tenantId: string,
    candidate: ActivationCandidate,
  ): Promise<void> {
    if (!occupiesRentalOperation(candidate.contractType)) return;
    // `unreachable` ya se rechazó al validar la activación.
    const result = await occupyRentalOperation(tx, tenantId, candidate.propertyId);
    if (result.outcome === 'created') {
      this.logger.log(
        `Rental operation created as Alquilado: propertyId=${candidate.propertyId} contractId=${candidate.id}`,
      );
    } else if (result.outcome === 'moved') {
      this.logger.log(
        `State transition: operationId=${result.operationId} ${result.steps.join(' → ')} (contractId=${candidate.id})`,
      );
    }
  }

  /** Libera la operación de alquiler al dejar de estar activo (ver `releaseRentalOperation`). */
  private async releaseProperty(
    tx: any,
    contract: { id: string; propertyId: string; contractType: string },
  ): Promise<void> {
    const released = await releaseRentalOperation(tx, contract);
    if (released) {
      this.logger.log(
        `State transition: operationId=${released.operationId} Alquilado → Disponible (contractId=${contract.id})`,
      );
    }
  }

  /**
   * Pide el resumen de gestión del contrato recién cerrado sin esperarlo.
   *
   * La redacción puede tardar lo que tarde el modelo de lenguaje, y cerrar un
   * contrato no puede quedar esperando eso desde la pantalla. La generación
   * registra sus propias fallas, y si el resumen no queda escrito la ficha del
   * contrato ofrece generarlo.
   */
  private summarizeClosure(tenantId: string, contractId: string): void {
    this.closureSummaries.generateOnClosure(tenantId, contractId).catch((err: unknown) => {
      this.logger.warn('Closure summary generation failed', {
        contractId,
        tenantId,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
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
    // Índices desde el último ajuste aplicado o el inicio del contrato (DEF-07).
    // La modalidad se traduce a parámetros en un solo lugar: el servicio de ajustes.
    const window = await resolveAdjustmentWindow(
      this.prisma.client,
      contract,
      schedule.nextAdjustmentDate,
    );
    const loaded = await this.adjustments.loadParams(contract, window, { tenantId });
    if (loaded.fixedInitial) {
      // Dentro de los meses fijos iniciales no hay ajuste que calcular: el
      // barrido diario saltea el cronograma.
      throw new ConflictException({
        error: 'FIXED_INITIAL_PERIOD',
        message: 'The contract rent is fixed during its initial months; there is no adjustment to calculate',
      });
    }
    const adjustmentType = loaded.adjustmentType;

    const result = calculateAdjustment(loaded.params);

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
        indexValues: this.adjustments.buildIndexValues(loaded) as any,
        notes: loaded.isProvisional ? 'PROVISIONAL' : null,
        calculatedAt: new Date(),
        isProvisional: loaded.isProvisional,
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
    // Los borradores de liquidación del contrato pasan al alquiler nuevo (DEF-133).
    await this.adjustments.notifyApplied({
      tenantId,
      contractId,
      adjustmentId,
      adjustmentDate: adjustment.adjustmentDate,
    });

    return this.findOne(contractId);
  }

  // ─── List Adjustments ───────────────────────────────

  async findAdjustments(contractId: string, options: { pendingTrueUp?: boolean; upTo?: string } = {}) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    // Correcciones de ajustes provisorios sin facturar: lo que lee el armado de liquidaciones.
    if (options.pendingTrueUp) {
      if (options.upTo !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(options.upTo)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'upTo must be YYYY-MM',
        });
      }
      return this.adjustments.getPendingTrueUps(contractId, options.upTo);
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
      startDate,
      endDate,
      period,
      1,
    );
  }

  /**
   * Fechas `anchor + k períodos` (k = 1, 2, ...) hasta `endDate`. `anchor` es
   * el inicio del contrato o la fecha del último ajuste ya aplicado.
   */
  private generateScheduleEntriesFrom(
    anchor: Date,
    endDate: Date,
    period: AdjustmentPeriod,
    startPeriod: number,
  ): { date: Date; periodNumber: number }[] {
    const entries: { date: Date; periodNumber: number }[] = [];
    const months = periodToMonths(period);
    // Cada fecha se calcula desde el ancla, no desde la anterior: encadenar
    // con recorte a fin de mes arrastra el desvío.
    for (let k = 1; ; k++) {
      const date = addMonthsClamped(anchor, k * months);
      if (date > endDate) break;
      entries.push({ date, periodNumber: startPeriod + k - 1 });
    }

    return entries;
  }
}
