import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreatePropertyOwnershipSchema, PersonRole } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { ensureRole } from '../persons/person-roles.service';

/**
 * Titularidad de una propiedad: quién es titular y, si se sabe, con qué
 * porcentaje y por qué título. Es información; no define a quién se le paga
 * (eso lo hacen los locadores del contrato) y no se exige que sume 100 %.
 */
@Injectable()
export class PropertyOwnershipsService {
  private readonly logger = new Logger(PropertyOwnershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async assertProperty(id: string) {
    const property = await this.prisma.client.property.findFirst({ where: { id } });
    if (!property) {
      throw new NotFoundException({ error: 'PROPERTY_NOT_FOUND', message: 'Property not found' });
    }
  }

  async list(propertyId: string) {
    await this.assertProperty(propertyId);
    return this.prisma.client.propertyOwnership.findMany({
      where: { propertyId },
      include: { person: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(propertyId: string, data: unknown) {
    const validated: any = parseOrThrow(CreatePropertyOwnershipSchema, data, 'Invalid ownership data');
    await this.assertProperty(propertyId);
    const tenantId = this.tenantContext.getTenantId()!;

    const person = await this.prisma.client.person.findFirst({ where: { id: validated.personId } });
    if (!person) {
      throw new NotFoundException({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
    }

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const ownership = await tx.propertyOwnership.create({
        data: {
          tenantId,
          propertyId,
          personId: validated.personId,
          sharePct: validated.sharePct ?? null,
          title: validated.title ?? null,
          since: validated.since ? new Date(validated.since) : null,
          until: validated.until ? new Date(validated.until) : null,
        },
        include: { person: true },
      });
      await ensureRole(tx, validated.personId, PersonRole.Propietario);
      return ownership;
    });

    this.logger.log(`Ownership added: propertyId=${propertyId} personId=${validated.personId}`);
    return created;
  }

  async remove(propertyId: string, ownershipId: string) {
    const ownership = await this.prisma.client.propertyOwnership.findFirst({
      where: { id: ownershipId, propertyId },
    });
    if (!ownership) {
      throw new NotFoundException({ error: 'OWNERSHIP_NOT_FOUND', message: 'Ownership not found' });
    }
    await this.prisma.client.propertyOwnership.delete({ where: { id: ownershipId } });
    this.logger.log(`Ownership removed: propertyId=${propertyId} ownershipId=${ownershipId}`);
    return { deleted: true };
  }
}
