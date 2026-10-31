import { Injectable, Logger } from '@nestjs/common';
import { ReadPolicy, resolveReadPolicy } from '@realfy/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Política de lectura por rol de cada inmobiliaria (Tenant.readPolicy).
 * Sin valor guardado rige la política por defecto: todos los roles de
 * personal leen todo.
 */
@Injectable()
export class ReadPolicyService {
  private readonly logger = new Logger(ReadPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Política vigente de la inmobiliaria. Lanza si no se puede cargar o si lo
   * guardado no es válido: quien decide el acceso debe fallar cerrado.
   */
  async getPolicy(tenantId: string): Promise<ReadPolicy> {
    const tenant = await this.prisma.baseClient.tenant.findUnique({
      where: { id: tenantId },
      select: { readPolicy: true },
    });
    if (!tenant) throw new Error(`Inmobiliaria ${tenantId} inexistente`);
    return resolveReadPolicy(tenant.readPolicy);
  }

  /** Guarda una política ya validada con ReadPolicySchema. */
  async setPolicy(tenantId: string, policy: ReadPolicy): Promise<ReadPolicy> {
    await this.prisma.baseClient.tenant.update({
      where: { id: tenantId },
      data: { readPolicy: policy },
    });
    this.logger.log(`Política de lectura actualizada: tenant=${tenantId}`);
    return resolveReadPolicy(policy);
  }
}
