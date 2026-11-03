import { Injectable, Logger } from '@nestjs/common';
import { BillChannel, BillFetchResult } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { BillFetcherRegistry } from './bill-fetcher.registry';
import { BillIntakeService } from './bill-intake.service';
import { BillFetchBlockedError, type BillFetchTarget } from './providers';

/** Servicios que se consultan por proveedor y por vuelta. */
const MAX_SERVICES_PER_PROVIDER = 500;

export interface BillFetchSummary {
  /** La obtención por consulta está apagada para la inmobiliaria. */
  disabled: boolean;
  attempts: number;
  documents: number;
}

/**
 * Consulta diaria a los proveedores (canal `Consulta`, ADR-0018). Corre dentro del
 * contexto de la inmobiliaria: sólo si la habilitó (`operationalDefaults.billFetching`),
 * sólo para los proveedores que eligió y que tienen conector, y para sus servicios
 * activos con cuenta. Cada intento deja un `BillFetchRun`; los documentos que traen
 * entran al circuito común.
 */
@Injectable()
export class BillFetchService {
  private readonly logger = new Logger(BillFetchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: OperationalDefaultsService,
    private readonly registry: BillFetcherRegistry,
    private readonly intake: BillIntakeService,
  ) {}

  async runForTenant(tenantId: string, now: Date = new Date()): Promise<BillFetchSummary> {
    const settings = (await this.defaults.get(tenantId)).billFetching;
    const summary: BillFetchSummary = { disabled: !settings.enabled, attempts: 0, documents: 0 };
    if (!settings.enabled) return summary;

    for (const providerKey of settings.providers) {
      const fetcher = this.registry.get(providerKey);
      if (!fetcher) continue;
      const services = await this.prisma.client.service.findMany({
        where: { isActive: true, providerKey, accountNumber: { not: null } },
        select: { id: true, propertyId: true, providerKey: true, accountNumber: true },
        orderBy: { id: 'asc' },
        take: MAX_SERVICES_PER_PROVIDER,
      });
      for (const service of services) {
        const target: BillFetchTarget = {
          id: service.id,
          propertyId: service.propertyId,
          providerKey,
          accountNumber: service.accountNumber!,
        };
        const startedAt = new Date();
        let result: BillFetchResult = BillFetchResult.SinNovedad;
        let errorCode: string | null = null;
        let errorMessage: string | null = null;
        let documents = 0;
        try {
          const fetched = await fetcher.fetch(target, { tenantId, now });
          for (const file of fetched) {
            const { duplicate } = await this.intake.intake(
              { channel: BillChannel.Consulta, origin: providerKey, fileName: file.fileName, content: file.content },
              now,
            );
            if (!duplicate) documents++;
          }
          if (documents > 0) result = BillFetchResult.Ok;
        } catch (error) {
          const blocked = error instanceof BillFetchBlockedError;
          result = blocked ? BillFetchResult.Bloqueado : BillFetchResult.Error;
          errorCode = blocked ? error.code : 'FETCH_FAILED';
          errorMessage = (error as Error).message.slice(0, 500);
          this.logger.warn(`Bill fetch failed: tenantId=${tenantId} provider=${providerKey} serviceId=${service.id} result=${result}`);
        }
        await this.prisma.client.billFetchRun.create({
          data: {
            tenantId,
            serviceId: service.id,
            providerKey,
            channel: BillChannel.Consulta,
            startedAt,
            finishedAt: new Date(),
            result,
            errorCode,
            errorMessage,
            documents,
          },
        });
        summary.attempts++;
        summary.documents += documents;
      }
    }
    return summary;
  }
}
