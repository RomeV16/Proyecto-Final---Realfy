import { Injectable, Logger } from '@nestjs/common';
import { OperationalDefaults, resolveOperationalDefaults } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Valores por defecto de la operación de cada inmobiliaria
 * (Tenant.operationalDefaults). Sin valor guardado rigen los del código
 * (`DEFAULT_OPERATIONAL_DEFAULTS`); un contrato o un acuerdo pueden pisarlos.
 */
@Injectable()
export class OperationalDefaultsService {
  private readonly logger = new Logger(OperationalDefaultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valores vigentes. `client` permite leer dentro de una transacción; sin él
   * se usa el cliente base con el filtro explícito por inmobiliaria.
   */
  async get(
    tenantId: string,
    client: { tenant: { findUnique: (args: any) => Promise<any> } } = this.prisma.baseClient,
  ): Promise<OperationalDefaults> {
    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { operationalDefaults: true },
    });
    if (!tenant) throw new Error(`Inmobiliaria ${tenantId} inexistente`);
    return resolveOperationalDefaults(tenant.operationalDefaults);
  }

  /** Guarda valores ya validados con OperationalDefaultsSchema. */
  async set(tenantId: string, values: OperationalDefaults): Promise<OperationalDefaults> {
    await this.prisma.baseClient.tenant.update({
      where: { id: tenantId },
      data: { operationalDefaults: values as any },
    });
    this.logger.log(`Valores por defecto actualizados: tenant=${tenantId}`);
    return values;
  }
}
