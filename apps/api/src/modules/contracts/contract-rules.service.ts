import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdjustmentType,
  CreateContractAgreementSchema,
  UpdateContractAgreementSchema,
} from '@realfy/shared';
import type { TermsPatch } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { ContractsService } from './contracts.service';
import { denormalizedColumns, getTermsAt } from './contract-terms';

/** Campos de la versión de reglas que se copian de la anterior. */
const TERMS_FIELDS = [
  'adjustmentType',
  'adjustmentPeriod',
  'adjustmentBase',
  'indexLagMonths',
  'fixedInitialMonths',
  'customPct',
  'customSteps',
  'rentOverride',
  'discountPct',
  'discountAmount',
  'dueDay',
  'paymentFlow',
  'penaltyConfig',
] as const;

const JSON_FIELDS = new Set(['customSteps', 'penaltyConfig']);

/** Un null de JSON se guarda como NULL de base, no como el valor JSON null. */
function toDbValue(field: string, value: unknown) {
  if (JSON_FIELDS.has(field) && value === null) return Prisma.DbNull;
  return value as any;
}

const notFound = (error: string, message: string) => new NotFoundException({ error, message });

/**
 * Convenios del contrato y sus reglas versionadas. Un convenio que cambia las
 * reglas crea una versión nueva (copia de la vigente a su fecha más el cambio)
 * en la misma transacción; las versiones nunca se pisan.
 */
@Injectable()
export class ContractRulesService {
  private readonly logger = new Logger(ContractRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly contracts: ContractsService,
  ) {}

  private async requireContract(contractId: string) {
    const contract = await this.prisma.client.contract.findFirst({ where: { id: contractId } });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    return contract;
  }

  // ─── Lecturas ───────────────────────────────────────

  /** Períodos del contrato en orden. */
  async listPeriods(contractId: string) {
    await this.requireContract(contractId);
    return this.prisma.client.contractPeriod.findMany({
      where: { contractId },
      orderBy: { seq: 'asc' },
    });
  }

  /**
   * Versiones de reglas del contrato y la vigente a `at` (hoy si se omite).
   * `current` es null si la fecha es anterior a la primera versión.
   */
  async listTerms(contractId: string, at?: string) {
    const contract = await this.requireContract(contractId);
    const date = at ? new Date(at) : new Date();
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'at must be a valid date' });
    }
    const versions = await this.prisma.client.contractTermsVersion.findMany({
      where: { contractId },
      orderBy: { validFrom: 'asc' },
    });
    const current = await getTermsAt(this.prisma.client, contract, date);
    return { at: date.toISOString(), current, versions };
  }

  async listAgreements(contractId: string) {
    await this.requireContract(contractId);
    return this.prisma.client.contractAgreement.findMany({
      where: { contractId },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      include: { versions: { orderBy: { validFrom: 'asc' } } },
    });
  }

  // ─── Alta ───────────────────────────────────────────

  async createAgreement(contractId: string, data: unknown) {
    const input = parseOrThrow(CreateContractAgreementSchema, data, 'Invalid agreement data');
    const contract = await this.requireContract(contractId);
    const tenantId = this.tenantContext.getTenantId()!;
    const effectiveFrom = new Date(input.effectiveFrom);

    if (effectiveFrom.getTime() < contract.startDate.getTime()) {
      throw new BadRequestException({
        error: 'AGREEMENT_BEFORE_START',
        message: 'effectiveFrom must not be before the contract start date',
      });
    }

    const { agreementId, periodChanged } = await this.prisma.client.$transaction(async (tx: any) => {
      const agreement = await tx.contractAgreement.create({
        data: {
          tenantId,
          contractId,
          kind: input.kind,
          effectiveFrom,
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          documentUrl: input.documentUrl ?? null,
          notes: input.notes ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
        },
      });

      if (!input.termsPatch) return { agreementId: agreement.id as string, periodChanged: false };

      const duplicated = await tx.contractTermsVersion.findFirst({
        where: { contractId, validFrom: effectiveFrom },
        select: { id: true },
      });
      if (duplicated) {
        throw new ConflictException({
          error: 'TERMS_VERSION_EXISTS',
          message: 'There is already a rules version starting on that date',
        });
      }

      const base = await getTermsAt(tx, contract, effectiveFrom);
      if (!base) {
        throw new BadRequestException({
          error: 'AGREEMENT_BEFORE_START',
          message: 'There is no rules version in force on that date',
        });
      }
      const merged = this.mergeTerms(base, input.termsPatch);
      this.assertConsistent(merged);

      await tx.contractTermsVersion.create({
        data: {
          tenantId,
          contractId,
          validFrom: effectiveFrom,
          agreementId: agreement.id,
          ...Object.fromEntries(TERMS_FIELDS.map((f) => [f, toDbValue(f, merged[f])])),
        },
      });

      return {
        agreementId: agreement.id as string,
        periodChanged: await this.syncDenormalized(tx, contract),
      };
    });

    if (periodChanged) await this.contracts.rebuildPendingSchedule(contractId);

    this.logger.log('Created agreement', { contractId, tenantId, kind: input.kind });
    return this.findAgreement(contractId, agreementId);
  }

  // ─── Cambio y baja ──────────────────────────────────

  /** Solo se tocan los datos del convenio, y solo si ninguna versión posterior depende de él. */
  async updateAgreement(contractId: string, agreementId: string, data: unknown) {
    const input = parseOrThrow(UpdateContractAgreementSchema, data, 'Invalid agreement data');
    const agreement = await this.requireAgreement(contractId, agreementId);
    await this.assertNoLaterVersions(contractId, agreement);

    await this.prisma.client.contractAgreement.update({
      where: { id: agreementId },
      data: {
        ...(input.effectiveTo !== undefined && {
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        }),
        ...(input.documentUrl !== undefined && { documentUrl: input.documentUrl }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
    });
    return this.findAgreement(contractId, agreementId);
  }

  /** Borra el convenio y su versión de reglas, si no hay versiones posteriores. */
  async removeAgreement(contractId: string, agreementId: string) {
    const contract = await this.requireContract(contractId);
    const agreement = await this.requireAgreement(contractId, agreementId);
    await this.assertNoLaterVersions(contractId, agreement);

    const periodChanged = await this.prisma.client.$transaction(async (tx: any) => {
      await tx.contractTermsVersion.deleteMany({ where: { agreementId } });
      await tx.contractAgreement.delete({ where: { id: agreementId } });
      return this.syncDenormalized(tx, contract);
    });
    if (periodChanged) await this.contracts.rebuildPendingSchedule(contractId);

    return { deleted: true };
  }

  // ─── Helpers ────────────────────────────────────────

  private async requireAgreement(contractId: string, agreementId: string) {
    await this.requireContract(contractId);
    const agreement = await this.prisma.client.contractAgreement.findFirst({
      where: { id: agreementId, contractId },
      include: { versions: true },
    });
    if (!agreement) throw notFound('AGREEMENT_NOT_FOUND', 'Agreement not found');
    return agreement;
  }

  private findAgreement(contractId: string, agreementId: string) {
    return this.prisma.client.contractAgreement.findFirst({
      where: { id: agreementId, contractId },
      include: { versions: { orderBy: { validFrom: 'asc' } } },
    });
  }

  private async assertNoLaterVersions(
    contractId: string,
    agreement: { versions: { validFrom: Date }[] },
  ) {
    for (const version of agreement.versions) {
      const later = await this.prisma.client.contractTermsVersion.count({
        where: { contractId, validFrom: { gt: version.validFrom } },
      });
      if (later > 0) {
        throw new ConflictException({
          error: 'AGREEMENT_HAS_LATER_VERSIONS',
          message: 'A later rules version depends on this agreement',
        });
      }
    }
  }

  private mergeTerms(base: Record<string, any>, patch: TermsPatch): Record<string, any> {
    const merged: Record<string, any> = {};
    for (const field of TERMS_FIELDS) {
      merged[field] = patch[field] !== undefined ? patch[field] : base[field];
    }
    return merged;
  }

  private assertConsistent(terms: Record<string, any>) {
    const type = terms.adjustmentType as AdjustmentType;
    const needsPct = type === AdjustmentType.FixedPercent || type === AdjustmentType.Custom;
    if (needsPct && !terms.customPct) {
      throw new BadRequestException({
        error: 'MISSING_ADJUSTMENT_PCT',
        message: `customPct is required for ${type}`,
      });
    }
    if (type === AdjustmentType.Escalonado && !terms.customSteps) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'customSteps is required for Escalonado',
      });
    }
  }

  /**
   * Deja las columnas de ajuste del contrato iguales a la versión vigente hoy.
   * Devuelve true si cambió la periodicidad, para rehacer el cronograma.
   */
  private async syncDenormalized(tx: any, contract: any): Promise<boolean> {
    const current = await getTermsAt(tx, contract, new Date());
    if (!current) return false;
    const columns = denormalizedColumns(current);
    const same =
      columns.adjustmentType === contract.adjustmentType &&
      columns.adjustmentPeriod === contract.adjustmentPeriod &&
      String(columns.customAdjustmentPct ?? '') === String(contract.customAdjustmentPct ?? '');
    if (same) return false;
    await tx.contract.update({ where: { id: contract.id }, data: columns });
    return columns.adjustmentPeriod !== contract.adjustmentPeriod;
  }
}
