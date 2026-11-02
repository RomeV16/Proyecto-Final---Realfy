import { Injectable, Logger } from '@nestjs/common';
import {
  ContractAgreementKind,
  ContractStatus,
  FollowUpOutcome,
  OralExtensionSchema,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { ContractsService } from '../contracts/contracts.service';
import { getEffectiveEndDate } from '../contracts/contract-terms';
import { FollowUpsService } from './follow-ups.service';

/**
 * Prórroga de palabra: el inquilino sigue más allá del fin firmado sin papeles.
 * Se registra como convenio, mueve el fin efectivo (`actualEndDate`) y deja
 * intacto el fin pactado (`endDate`). Los seguimientos abiertos se cierran como
 * prorrogados; el proceso diario abre otro cuando el nuevo fin se acerque.
 */
@Injectable()
export class OralExtensionService {
  private readonly logger = new Logger(OralExtensionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly contracts: ContractsService,
    private readonly followUps: FollowUpsService,
  ) {}

  async extend(contractId: string, data: unknown) {
    const input = parseOrThrow(OralExtensionSchema, data, 'Invalid extension data');
    const contract = await this.prisma.client.contract.findFirst({ where: { id: contractId } });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const wasExpired = contract.status === ContractStatus.Vencido;
    if (contract.status !== ContractStatus.Activo && !wasExpired) {
      throw conflict('CONTRACT_NOT_ACTIVE', 'Only an active or expired contract can be extended');
    }

    const until = dayStart(input.until);
    const currentEnd = getEffectiveEndDate(contract);
    if (until.getTime() <= currentEnd.getTime()) {
      throw badRequest('EXTENSION_NOT_AFTER_END', 'The extension must end after the current effective end');
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const agreement = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.contractAgreement.create({
        data: {
          tenantId,
          contractId,
          kind: ContractAgreementKind.Prorroga,
          effectiveFrom: currentEnd,
          effectiveTo: until,
          notes: input.note,
          createdById: this.tenantContext.getUserId() ?? null,
        },
      });
      if (wasExpired) await this.contracts.reactivateExpired(tx, contract, until);
      await tx.contract.update({ where: { id: contractId }, data: { actualEndDate: until } });
      const closed = await this.followUps.closeOpenForContract(tx, contractId, FollowUpOutcome.Prorrogado);
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Contract',
        entityId: contractId,
        before: auditJson({ status: contract.status, actualEndDate: contract.actualEndDate, endDate: contract.endDate }),
        after: auditJson({
          status: wasExpired ? ContractStatus.Activo : contract.status,
          actualEndDate: until,
          endDate: contract.endDate,
        }),
        metadata: {
          operation: 'oral-extension',
          agreementId: created.id,
          note: input.note,
          followUpsClosed: closed,
          reactivated: wasExpired,
        },
      });
      return created;
    });

    // El cronograma de ajustes llega hasta el fin efectivo.
    await this.contracts.rebuildPendingSchedule(contractId);

    this.logger.log('Oral extension recorded', { contractId, tenantId, until: input.until });
    return { agreement, contract: await this.contracts.findOne(contractId) };
  }
}
