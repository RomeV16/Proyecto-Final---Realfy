import { Injectable, Logger } from '@nestjs/common';
import {
  ContractAgreementKind,
  ContractPeriodKind,
  ContractStatus,
  FollowUpOutcome,
  PersonRole,
  RenewContractSchema,
  todayInAR,
} from '@realfy/shared';
import type { TermsPatch } from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { ContractRulesService } from '../contracts/contract-rules.service';
import { ContractsService } from '../contracts/contracts.service';
import { getEffectiveEndDate } from '../contracts/contract-terms';
import { FollowUpsService } from './follow-ups.service';

/**
 * Renovación como período del mismo contrato (4.3). No se clona el contrato:
 * se agrega un período `Renovacion` con su alquiler inicial, un convenio
 * `Renovacion` con la versión de reglas nueva (alquiler y regla de ajuste) y
 * el fin pactado pasa a ser el del período. Garantes y honorarios quedan
 * anotados en el período. Los seguimientos abiertos se cierran como renovados.
 */
@Injectable()
export class ContractRenewalService {
  private readonly logger = new Logger(ContractRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly rules: ContractRulesService,
    private readonly contracts: ContractsService,
    private readonly followUps: FollowUpsService,
  ) {}

  async renew(contractId: string, data: unknown) {
    const input = parseOrThrow(RenewContractSchema, data, 'Invalid renewal data');
    const contract = await this.prisma.client.contract.findFirst({ where: { id: contractId } });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const wasExpired = contract.status === ContractStatus.Vencido;
    if (contract.status !== ContractStatus.Activo && !wasExpired) {
      throw conflict('CONTRACT_NOT_ACTIVE', 'Only an active or expired contract can be renewed');
    }

    const start = dayStart(input.start);
    const end = dayStart(input.end);
    const last = await this.prisma.client.contractPeriod.findFirst({
      where: { contractId },
      orderBy: { seq: 'desc' },
    });
    if (last && start.getTime() <= last.startDate.getTime()) {
      throw badRequest('RENEWAL_BEFORE_PERIOD_START', 'The renewal must start after the current period starts');
    }
    const laterTerms = await this.prisma.client.contractTermsVersion.count({
      where: { contractId, validFrom: { gte: start } },
    });
    if (laterTerms > 0) {
      throw conflict('TERMS_VERSION_EXISTS', 'There is already a rules version starting on or after that date');
    }
    await this.assertGuarantors(contractId, input.guarantorPersonIds ?? []);

    const termsPatch: TermsPatch = { rentOverride: input.rent, ...input.adjustment };
    const tenantId = this.tenantContext.getTenantId()!;
    const startsAlready = start.getTime() <= todayInAR().getTime();

    await this.rules.createAgreement(
      contractId,
      {
        kind: ContractAgreementKind.Renovacion,
        effectiveFrom: start,
        effectiveTo: end,
        notes: input.notes ?? null,
        termsPatch,
      },
      async (tx, agreementId) => {
        await tx.contractPeriod.create({
          data: {
            tenantId,
            contractId,
            seq: (last?.seq ?? 0) + 1,
            kind: ContractPeriodKind.Renovacion,
            startDate: start,
            endDate: end,
            initialRent: input.rent,
            signedAt: input.signedAt ? dayStart(input.signedAt) : null,
            feeAmount: input.fee?.amount ?? null,
            feeCurrency: input.fee?.currency ?? null,
            guarantorPersonIds: input.guarantorPersonIds ?? [],
          },
        });
        if (wasExpired) await this.contracts.reactivateExpired(tx, contract, end);
        // El fin pactado pasa a ser el del período; la prórroga de palabra queda absorbida.
        await tx.contract.update({
          where: { id: contractId },
          data: { endDate: end, actualEndDate: null, ...(startsAlready && { rentAmount: input.rent }) },
        });
        const closed = await this.followUps.closeOpenForContract(tx, contractId, FollowUpOutcome.Renovado);
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'Contract',
          entityId: contractId,
          before: auditJson({
            status: contract.status,
            endDate: contract.endDate,
            actualEndDate: contract.actualEndDate,
            rentAmount: contract.rentAmount,
          }),
          after: auditJson({
            status: wasExpired ? ContractStatus.Activo : contract.status,
            endDate: end,
            actualEndDate: null,
            rent: input.rent,
            start,
          }),
          metadata: {
            operation: 'renewal',
            agreementId,
            followUpsClosed: closed,
            fee: input.fee ?? null,
            reactivated: wasExpired,
          },
        });
      },
    );

    // El cronograma de ajustes llega hasta el nuevo fin.
    await this.contracts.rebuildPendingSchedule(contractId);
    this.logger.log('Renewal recorded', {
      contractId,
      tenantId,
      previousEnd: getEffectiveEndDate(contract).toISOString().slice(0, 10),
      end: input.end,
    });

    const periods = await this.rules.listPeriods(contractId);
    return { period: periods[periods.length - 1], contract: await this.contracts.findOne(contractId) };
  }

  /** Cada garante que reafirma tiene que ser un garante de este contrato. */
  private async assertGuarantors(contractId: string, personIds: string[]) {
    if (personIds.length === 0) return;
    const rows = await this.prisma.client.contractPerson.findMany({
      where: { contractId, role: PersonRole.Garante, personId: { in: personIds } },
      select: { personId: true },
    });
    const found = new Set(rows.map((r: { personId: string }) => r.personId));
    const missing = personIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw badRequest('GUARANTOR_NOT_IN_CONTRACT', `Not guarantors of this contract: ${missing.join(', ')}`);
    }
  }
}
