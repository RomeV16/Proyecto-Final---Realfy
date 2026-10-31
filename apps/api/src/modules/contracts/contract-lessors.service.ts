import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ContractStatus,
  CreateContractLessorSchema,
  PersonRole,
  ReplaceContractLessorsSchema,
  UpdateContractLessorSchema,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { ensureRole } from '../persons/person-roles.service';
import { getLessorsAt } from './contract-parties';
import { assertLessorRefs, assertLessorShares } from './lessor-rules';

const INCLUDE = { person: true, payee: true, bankAccount: true } as const;

/**
 * Locadores de un contrato: quién alquila y cuánto del cobro le corresponde.
 *
 * Las altas, cambios y bajas sueltas de un contrato que ya salió de Borrador
 * tienen que dejar a los locadores vigentes sumando 100 % en cada fecha; como
 * eso a veces exige cambiar varias filas a la vez (repartir entre dos, ceder a
 * otro), `replace` cambia todo el conjunto en una transacción. En Borrador el
 * conjunto se puede armar de a una fila y la suma se exige al activar.
 */
@Injectable()
export class ContractLessorsService {
  private readonly logger = new Logger(ContractLessorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async loadContract(id: string) {
    const contract = await this.prisma.client.contract.findFirst({ where: { id } });
    if (!contract) {
      throw new NotFoundException({ error: 'CONTRACT_NOT_FOUND', message: 'Contract not found' });
    }
    return contract;
  }

  private async findLessor(contractId: string, lessorId: string, db: any = this.prisma.client) {
    const lessor = await db.contractLessor.findFirst({ where: { id: lessorId, contractId } });
    if (!lessor) {
      throw new NotFoundException({ error: 'LESSOR_NOT_FOUND', message: 'Lessor not found' });
    }
    return lessor;
  }

  async list(contractId: string, at?: string) {
    const contract = await this.loadContract(contractId);
    if (at) {
      return getLessorsAt(this.prisma.client, contractId, new Date(at));
    }
    return this.prisma.client.contractLessor.findMany({
      where: { contractId: contract.id },
      include: INCLUDE,
      orderBy: [{ validFrom: 'asc' }, { payoutPct: 'desc' }, { id: 'asc' }],
    });
  }

  async create(contractId: string, data: unknown) {
    const validated: any = parseOrThrow(CreateContractLessorSchema, data, 'Invalid lessor data');
    const contract = await this.loadContract(contractId);
    const tenantId = this.tenantContext.getTenantId()!;
    const validFrom = validated.validFrom ? new Date(validated.validFrom) : contract.startDate;

    await this.prisma.client.$transaction(async (tx: any) => {
      await assertLessorRefs(tx, validated, {
        contractId,
        propertyId: contract.propertyId,
        at: validFrom,
      });
      await tx.contractLessor.create({
        data: {
          tenantId,
          contractId,
          personId: validated.personId,
          capacity: validated.capacity,
          payoutPct: validated.payoutPct,
          payeePersonId: validated.payeePersonId ?? null,
          bankAccountId: validated.bankAccountId ?? null,
          validFrom,
          validTo: validated.validTo ? new Date(validated.validTo) : null,
        },
      });
      await ensureRole(tx, validated.personId, PersonRole.Propietario);
      await this.assertSharesUnlessDraft(tx, contract);
    });

    this.logger.log(`Lessor added: contractId=${contractId} personId=${validated.personId}`);
    return this.list(contractId);
  }

  async update(contractId: string, lessorId: string, data: unknown) {
    const validated: any = parseOrThrow(UpdateContractLessorSchema, data, 'Invalid lessor data');
    const contract = await this.loadContract(contractId);

    await this.prisma.client.$transaction(async (tx: any) => {
      const current = await this.findLessor(contractId, lessorId, tx);
      const next = {
        personId: current.personId,
        bankAccountId:
          validated.bankAccountId !== undefined ? validated.bankAccountId : current.bankAccountId,
        payeePersonId:
          validated.payeePersonId !== undefined ? validated.payeePersonId : current.payeePersonId,
      };
      const validFrom = validated.validFrom ? new Date(validated.validFrom) : current.validFrom;
      const validTo =
        validated.validTo !== undefined
          ? validated.validTo
            ? new Date(validated.validTo)
            : null
          : current.validTo;
      if (validTo && validTo.getTime() <= validFrom.getTime()) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'validTo must be after validFrom',
        });
      }
      await assertLessorRefs(tx, next, {
        contractId,
        propertyId: contract.propertyId,
        at: validFrom,
      });
      await tx.contractLessor.update({
        where: { id: lessorId },
        data: {
          ...(validated.capacity ? { capacity: validated.capacity } : {}),
          ...(validated.payoutPct ? { payoutPct: validated.payoutPct } : {}),
          payeePersonId: next.payeePersonId,
          bankAccountId: next.bankAccountId,
          validFrom,
          validTo,
          // Tocar el reparto o confirmarlo a mano baja la marca de revisión.
          needsReview: validated.needsReview ?? (validated.payoutPct ? false : current.needsReview),
        },
      });
      await this.assertSharesUnlessDraft(tx, contract);
    });

    return this.list(contractId);
  }

  async remove(contractId: string, lessorId: string) {
    const contract = await this.loadContract(contractId);
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.findLessor(contractId, lessorId, tx);
      await tx.contractLessor.delete({ where: { id: lessorId } });
      await this.assertSharesUnlessDraft(tx, contract);
    });
    this.logger.log(`Lessor removed: contractId=${contractId} lessorId=${lessorId}`);
    return { deleted: true };
  }

  /** Reemplaza todo el conjunto de locadores; siempre exige que sumen 100 %. */
  async replace(contractId: string, data: unknown) {
    const validated: any = parseOrThrow(ReplaceContractLessorsSchema, data, 'Invalid lessors data');
    const contract = await this.loadContract(contractId);
    const tenantId = this.tenantContext.getTenantId()!;

    await this.prisma.client.$transaction(async (tx: any) => {
      const keep = new Set<string>();
      for (const row of validated.lessors) {
        if (row.id) {
          await this.findLessor(contractId, row.id, tx);
          keep.add(row.id);
        }
      }
      await tx.contractLessor.deleteMany({
        where: { contractId, ...(keep.size > 0 ? { id: { notIn: [...keep] } } : {}) },
      });

      for (const row of validated.lessors) {
        const validFrom = row.validFrom ? new Date(row.validFrom) : contract.startDate;
        await assertLessorRefs(tx, row, {
          contractId,
          propertyId: contract.propertyId,
          at: validFrom,
        });
        const fields = {
          personId: row.personId,
          capacity: row.capacity,
          payoutPct: row.payoutPct,
          payeePersonId: row.payeePersonId ?? null,
          bankAccountId: row.bankAccountId ?? null,
          validFrom,
          validTo: row.validTo ? new Date(row.validTo) : null,
          needsReview: false,
        };
        if (row.id) {
          await tx.contractLessor.update({ where: { id: row.id }, data: fields });
        } else {
          await tx.contractLessor.create({ data: { tenantId, contractId, ...fields } });
        }
        await ensureRole(tx, row.personId, PersonRole.Propietario);
      }

      await assertLessorShares(tx, contract);
    });

    this.logger.log(`Lessors replaced: contractId=${contractId} count=${validated.lessors.length}`);
    return this.list(contractId);
  }

  private async assertSharesUnlessDraft(
    tx: any,
    contract: { id: string; status: string; startDate: Date; endDate: Date },
  ) {
    if (contract.status === ContractStatus.Borrador) return;
    await assertLessorShares(tx, contract);
  }
}
