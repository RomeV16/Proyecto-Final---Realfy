import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePowerOfAttorneySchema,
  PersonRole,
  PowerOfAttorneyFilterSchema,
  PowerScope,
  SignatureMode,
  UpdatePowerOfAttorneySchema,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { ensureRole } from './person-roles.service';

const INCLUDE = {
  principal: true,
  agent: true,
  contract: { select: { id: true, propertyId: true, startDate: true, endDate: true } },
  property: { select: { id: true, title: true } },
} as const;

/**
 * Poderes: una persona (apoderado) actúa en nombre de otra (el poderdante),
 * para cobrar, firmar o administrar. Sin contrato ni propiedad es un poder
 * general. La firma conjunta agrupa a los apoderados por `groupKey`: todos los
 * del grupo firman juntos; con firma indistinta cada uno puede firmar solo.
 */
@Injectable()
export class PersonPowersService {
  private readonly logger = new Logger(PersonPowersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async assertPerson(id: string, error = 'PERSON_NOT_FOUND') {
    const person = await this.prisma.client.person.findFirst({ where: { id } });
    if (!person) {
      throw new NotFoundException({ error, message: 'Person not found' });
    }
    return person;
  }

  private async findPower(principalId: string, powerId: string) {
    const power = await this.prisma.client.powerOfAttorney.findFirst({
      where: { id: powerId, principalId },
    });
    if (!power) {
      throw new NotFoundException({ error: 'POWER_NOT_FOUND', message: 'Power of attorney not found' });
    }
    return power;
  }

  /** Poderes donde la persona es poderdante (por defecto) o apoderada. */
  async list(personId: string, query: unknown) {
    const filters = parseOrThrow(PowerOfAttorneyFilterSchema, query, 'Invalid filter parameters');
    await this.assertPerson(personId);
    const on = filters.activeOn ? new Date(filters.activeOn) : null;
    return this.prisma.client.powerOfAttorney.findMany({
      where: {
        ...(filters.as === 'agent' ? { agentId: personId } : { principalId: personId }),
        ...(on
          ? {
              validFrom: { lte: on },
              OR: [{ validTo: null }, { validTo: { gt: on } }],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ validFrom: 'asc' }, { id: 'asc' }],
    });
  }

  async create(principalId: string, data: unknown) {
    const validated: any = parseOrThrow(CreatePowerOfAttorneySchema, data, 'Invalid power data');
    await this.assertPerson(principalId);
    if (validated.agentId === principalId) {
      throw new BadRequestException({
        error: 'POWER_SELF',
        message: 'A person cannot hold a power of attorney from themselves',
      });
    }
    await this.assertPerson(validated.agentId, 'AGENT_NOT_FOUND');

    let defaultFrom = new Date();
    if (validated.contractId) {
      const contract = await this.prisma.client.contract.findFirst({
        where: { id: validated.contractId },
      });
      if (!contract) {
        throw new BadRequestException({
          error: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validated.contractId} not found`,
        });
      }
      defaultFrom = contract.startDate;
    }
    if (validated.propertyId) {
      const property = await this.prisma.client.property.findFirst({
        where: { id: validated.propertyId },
      });
      if (!property) {
        throw new BadRequestException({
          error: 'PROPERTY_NOT_FOUND',
          message: `Property ${validated.propertyId} not found`,
        });
      }
    }

    const tenantId = this.tenantContext.getTenantId()!;
    // Los apoderados con firma conjunta sobre el mismo alcance firman juntos.
    const groupKey =
      validated.signatureMode === SignatureMode.Conjunta
        ? (validated.groupKey ??
          `${principalId}:${validated.contractId ?? validated.propertyId ?? 'general'}`)
        : null;

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const power = await tx.powerOfAttorney.create({
        data: {
          tenantId,
          principalId,
          agentId: validated.agentId,
          scopes: validated.scopes,
          signatureMode: validated.signatureMode,
          groupKey,
          contractId: validated.contractId ?? null,
          propertyId: validated.propertyId ?? null,
          validFrom: validated.validFrom ? new Date(validated.validFrom) : defaultFrom,
          validTo: validated.validTo ? new Date(validated.validTo) : null,
          documentUrl: validated.documentUrl ?? null,
        },
        include: INCLUDE,
      });
      await ensureRole(tx, validated.agentId, PersonRole.Apoderado);
      return power;
    });

    this.logger.log(`Power created: principalId=${principalId} agentId=${validated.agentId}`);
    return created;
  }

  async update(principalId: string, powerId: string, data: unknown) {
    const validated: any = parseOrThrow(UpdatePowerOfAttorneySchema, data, 'Invalid power data');
    const current = await this.findPower(principalId, powerId);

    const scopes: string[] = validated.scopes ?? current.scopes;
    const signatureMode = validated.signatureMode ?? current.signatureMode;
    const validTo =
      validated.validTo !== undefined
        ? validated.validTo
          ? new Date(validated.validTo)
          : null
        : current.validTo;
    const validFrom = validated.validFrom ? new Date(validated.validFrom) : current.validFrom;
    if (validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'validTo must be after validFrom',
      });
    }
    const groupKey =
      signatureMode === SignatureMode.Conjunta
        ? (validated.groupKey ??
          current.groupKey ??
          `${principalId}:${current.contractId ?? current.propertyId ?? 'general'}`)
        : null;

    const stillCollects = scopes.includes(PowerScope.Cobrar) && validTo === null;
    if (!stillCollects) await this.assertNotInUse(current);

    return this.prisma.client.powerOfAttorney.update({
      where: { id: powerId },
      data: {
        scopes,
        signatureMode,
        groupKey,
        validFrom,
        validTo,
        ...(validated.documentUrl !== undefined ? { documentUrl: validated.documentUrl } : {}),
      },
      include: INCLUDE,
    });
  }

  async remove(principalId: string, powerId: string) {
    const current = await this.findPower(principalId, powerId);
    await this.assertNotInUse(current);
    await this.prisma.client.powerOfAttorney.delete({ where: { id: powerId } });
    this.logger.log(`Power removed: principalId=${principalId} powerId=${powerId}`);
    return { deleted: true };
  }

  /** Un poder para cobrar que un locador usa para que cobre su apoderado no se puede quitar. */
  private async assertNotInUse(power: { principalId: string; agentId: string; scopes: string[] }) {
    if (!power.scopes.includes(PowerScope.Cobrar)) return;
    const now = new Date();
    const inUse = await this.prisma.client.contractLessor.count({
      where: {
        personId: power.principalId,
        payeePersonId: power.agentId,
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
    });
    if (inUse > 0) {
      throw new ConflictException({
        error: 'POWER_IN_USE',
        message: 'The agent is the payee of a lessor of this principal; change the payee first',
      });
    }
  }
}
