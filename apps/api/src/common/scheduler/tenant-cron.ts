import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { RequestContextService } from '../logger/request-context.service';

/** Inmobiliaria que recibe `forEachActiveTenant` en cada vuelta. */
export interface CronTenant {
  id: string;
  name: string;
}

export interface TenantCronSummary {
  /** Inmobiliarias cuya vuelta terminó sin error. */
  ok: number;
  /** Inmobiliarias cuya vuelta lanzó un error (ya registrado en el log). */
  failed: number;
}

/**
 * Recorre las inmobiliarias activas para los procesos programados.
 *
 * Cada vuelta corre dentro de su propio contexto CLS con la inmobiliaria ya
 * fijada, de modo que `prisma.client` (el cliente con la extensión de tenant)
 * filtra solo y falla cerrado fuera de ese contexto (ADR 0006). El proceso no
 * escribe `tenantId` a mano en los filtros ni usa `baseClient` para los datos
 * de la inmobiliaria. Un error en una inmobiliaria se registra con el nombre
 * del proceso, el `tenantId` y el identificador de correlación y no corta a
 * las demás.
 */
@Injectable()
export class TenantCron {
  private readonly logger = new Logger(TenantCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly tenantContext: TenantContextService,
    private readonly requestContext: RequestContextService,
  ) {}

  async forEachActiveTenant(
    jobName: string,
    fn: (tenantId: string, tenant: CronTenant) => Promise<void>,
  ): Promise<TenantCronSummary> {
    // La lista de inmobiliarias es lo único que se lee sin contexto: el
    // proceso todavía no sabe en cuál de ellas está.
    const tenants = await this.prisma.baseClient.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const summary: TenantCronSummary = { ok: 0, failed: 0 };

    for (const tenant of tenants) {
      const correlationId = `cron-${jobName}-${randomUUID()}`;
      try {
        // `override`: un contexto nuevo y limpio aunque el proceso se dispare
        // desde un pedido HTTP (sin heredar su usuario ni sus exenciones).
        await this.cls.run({ ifNested: 'override' }, async () => {
          this.tenantContext.setTenantId(tenant.id);
          this.requestContext.setCorrelationId(correlationId);
          await fn(tenant.id, tenant);
        });
        summary.ok++;
      } catch (err) {
        summary.failed++;
        this.logger.error(
          `Cron "${jobName}" failed: tenantId=${tenant.id} correlationId=${correlationId} error=${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    return summary;
  }
}
