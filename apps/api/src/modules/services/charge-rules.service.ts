import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ChargeRuleFilterSchema,
  ChargeSplitMode,
  ContractAgreementKind,
  ContractStatus,
  CreateChargeRuleSchema,
  UpdateChargeRuleSchema,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { pickRuleAt } from './charge-rule-dates';
import { ServiceBillsService } from './service-bills.service';

type Db = any;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (value: string): Date =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
const dayOnly = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });
const badRequest = (error: string, message: string) => new BadRequestException({ error, message });

const RULE_INCLUDE = {
  service: { select: { id: true, serviceType: true, providerName: true, propertyId: true } },
  agreement: { select: { id: true, kind: true, effectiveFrom: true } },
} as const;

/**
 * Reglas de traslado de impuestos y servicios por contrato, versionadas por
 * fecha de inicio. Una regla nueva cierra la vigente del mismo servicio (el día
 * anterior) y nunca la pisa. En un contrato que ya no es borrador el cambio
 * necesita el acuerdo (`CambioCargo`) que lo respalda. Ver ADR-0008.
 */
@Injectable()
export class ChargeRulesService {
  private readonly logger = new Logger(ChargeRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly bills: ServiceBillsService,
  ) {}

  private async requireContract(contractId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      include: { property: { select: { id: true, parentPropertyId: true } } },
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    return contract;
  }

  // ─── Lectura ────────────────────────────────────────

  /**
   * Reglas del contrato: `current` son las vigentes a `at` (hoy si se omite) y
   * `versions` todas, con las ya cerradas.
   */
  async list(contractId: string, query: unknown) {
    const filters = parseOrThrow(ChargeRuleFilterSchema, query, 'Invalid filter parameters');
    await this.requireContract(contractId);
    const at = filters.at ? dayStart(filters.at) : dayOnly(new Date());
    if (Number.isNaN(at.getTime())) throw badRequest('VALIDATION_ERROR', 'at must be a valid date');

    const versions = await this.prisma.client.contractChargeRule.findMany({
      where: { contractId, ...(filters.serviceId && { serviceId: filters.serviceId }) },
      include: RULE_INCLUDE,
      orderBy: [{ serviceId: 'asc' }, { validFrom: 'asc' }],
    });
    const byService = new Map<string, typeof versions>();
    for (const rule of versions) byService.set(rule.serviceId, [...(byService.get(rule.serviceId) ?? []), rule]);
    const current = [...byService.values()]
      .map((list) => pickRuleAt(list, at))
      .filter((rule): rule is (typeof versions)[number] => rule !== null);
    return { at: at.toISOString(), current, versions };
  }

  // ─── Alta ───────────────────────────────────────────

  async create(contractId: string, data: unknown) {
    const input = parseOrThrow(CreateChargeRuleSchema, data, 'Invalid charge rule data');
    const contract = await this.requireContract(contractId);
    const tenantId = this.tenantContext.getTenantId()!;
    const validFrom = dayStart(input.validFrom);

    const service = await this.prisma.client.service.findFirst({ where: { id: input.serviceId } });
    if (!service) throw notFound('SERVICE_NOT_FOUND', 'Service not found');
    const sameProperty = service.propertyId === contract.propertyId;
    const ofBuilding = contract.property?.parentPropertyId === service.propertyId;
    if (!sameProperty && !ofBuilding) {
      throw badRequest('SERVICE_NOT_APPLICABLE', 'The service belongs to another property');
    }
    if (validFrom.getTime() < dayOnly(contract.startDate).getTime()) {
      throw badRequest('CHARGE_RULE_BEFORE_START', 'validFrom must not be before the contract start date');
    }
    await this.assertAgreement(contractId, contract.status, validFrom, input.agreementId ?? null);

    const id = await this.prisma.client.$transaction(async (tx: Db) => {
      const siblings = await tx.contractChargeRule.findMany({
        where: { contractId, serviceId: input.serviceId },
        orderBy: { validFrom: 'asc' },
      });
      if (siblings.some((r: any) => r.validFrom.getTime() === validFrom.getTime())) {
        throw conflict('CHARGE_RULE_EXISTS', 'There is already a rule for this service starting on that date');
      }
      const previous = [...siblings].reverse().find((r: any) => r.validFrom.getTime() < validFrom.getTime());
      const next = siblings.find((r: any) => r.validFrom.getTime() > validFrom.getTime());

      // La regla nueva termina donde empieza la siguiente (si hay) y cierra a la anterior.
      const dayBeforeNext = next ? new Date(next.validFrom.getTime() - DAY_MS) : null;
      let validTo = input.validTo ? dayStart(input.validTo) : null;
      if (dayBeforeNext && (!validTo || validTo.getTime() > dayBeforeNext.getTime())) validTo = dayBeforeNext;

      const dayBefore = new Date(validFrom.getTime() - DAY_MS);
      if (previous && (!previous.validTo || previous.validTo.getTime() > dayBefore.getTime())) {
        await tx.contractChargeRule.update({ where: { id: previous.id }, data: { validTo: dayBefore } });
      }

      const rule = await tx.contractChargeRule.create({
        data: {
          tenantId,
          contractId,
          serviceId: input.serviceId,
          payer: input.payer,
          splitMode: input.splitMode,
          tenantSharePct: input.tenantSharePct,
          fixedAmount: input.splitMode === ChargeSplitMode.Fijo ? (input.fixedAmount ?? null) : null,
          paymentPlan: input.paymentPlan,
          annualRecovery: input.annualRecovery,
          annualDiscountToTenant: input.annualDiscountToTenant,
          validFrom,
          validTo,
          agreementId: input.agreementId ?? null,
          notes: input.notes ?? null,
        },
      });
      await this.bills.reallocateService(tx, input.serviceId, validFrom);
      return rule.id as string;
    });

    this.logger.log('Created charge rule', { contractId, tenantId, serviceId: input.serviceId, payer: input.payer });
    return this.findRule(contractId, id);
  }

  // ─── Cambio ─────────────────────────────────────────

  /**
   * Corrige una regla que todavía no se usó para facturar. Una regla ya
   * facturada se reemplaza con una versión nueva. En un contrato que no es
   * borrador solo se corrige una regla que nació de un acuerdo.
   */
  async update(contractId: string, ruleId: string, data: unknown) {
    const input = parseOrThrow(UpdateChargeRuleSchema, data, 'Invalid charge rule data');
    const contract = await this.requireContract(contractId);
    const rule = await this.prisma.client.contractChargeRule.findFirst({ where: { id: ruleId, contractId } });
    if (!rule) throw notFound('CHARGE_RULE_NOT_FOUND', 'Charge rule not found');

    if (contract.status !== ContractStatus.Borrador && !rule.agreementId) {
      throw conflict(
        'CHARGE_RULE_REQUIRES_AGREEMENT',
        'This rule is part of the signed contract: register an agreement and create a new version',
      );
    }
    const used = await this.prisma.client.serviceBillAllocation.count({ where: { ruleId, billedAt: { not: null } } });
    if (used > 0) {
      throw conflict('CHARGE_RULE_IN_USE', 'The rule was already used in a liquidación: create a new version');
    }

    const splitMode = input.splitMode ?? rule.splitMode;
    const fixedAmount = input.fixedAmount !== undefined ? input.fixedAmount : rule.fixedAmount?.toString() ?? null;
    if (splitMode === ChargeSplitMode.Fijo && (fixedAmount == null || Number(fixedAmount) <= 0)) {
      throw badRequest('VALIDATION_ERROR', 'fixedAmount is required for Fijo');
    }
    const validTo = input.validTo !== undefined ? (input.validTo ? dayStart(input.validTo) : null) : rule.validTo;
    if (validTo && validTo.getTime() < rule.validFrom.getTime()) {
      throw badRequest('VALIDATION_ERROR', 'validTo must not be before validFrom');
    }

    await this.prisma.client.$transaction(async (tx: Db) => {
      await tx.contractChargeRule.update({
        where: { id: ruleId },
        data: {
          ...(input.payer !== undefined && { payer: input.payer }),
          splitMode,
          ...(input.tenantSharePct !== undefined && { tenantSharePct: input.tenantSharePct }),
          fixedAmount: splitMode === ChargeSplitMode.Fijo ? fixedAmount : null,
          ...(input.paymentPlan !== undefined && { paymentPlan: input.paymentPlan }),
          ...(input.annualRecovery !== undefined && { annualRecovery: input.annualRecovery }),
          ...(input.annualDiscountToTenant !== undefined && { annualDiscountToTenant: input.annualDiscountToTenant }),
          ...(input.validTo !== undefined && { validTo }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
      });
      await this.bills.reallocateService(tx, rule.serviceId, rule.validFrom);
    });
    return this.findRule(contractId, ruleId);
  }

  // ─── Helpers ────────────────────────────────────────

  /** En un contrato que ya no es borrador, la regla nueva nace de un acuerdo `CambioCargo` de la misma fecha. */
  private async assertAgreement(contractId: string, status: string, validFrom: Date, agreementId: string | null) {
    if (!agreementId) {
      if (status !== ContractStatus.Borrador) {
        throw conflict(
          'CHARGE_RULE_REQUIRES_AGREEMENT',
          'Changing the charge rules of a contract in force requires an agreement (CambioCargo)',
        );
      }
      return;
    }
    const agreement = await this.prisma.client.contractAgreement.findFirst({ where: { id: agreementId, contractId } });
    if (!agreement) throw notFound('AGREEMENT_NOT_FOUND', 'Agreement not found');
    if (agreement.kind !== ContractAgreementKind.CambioCargo) {
      throw badRequest('AGREEMENT_KIND_MISMATCH', 'The agreement must be of kind CambioCargo');
    }
    if (dayOnly(agreement.effectiveFrom).getTime() !== validFrom.getTime()) {
      throw badRequest('CHARGE_RULE_DATE_MISMATCH', 'validFrom must match the agreement effective date');
    }
  }

  private findRule(contractId: string, id: string) {
    return this.prisma.client.contractChargeRule.findFirst({ where: { id, contractId }, include: RULE_INCLUDE });
  }
}
