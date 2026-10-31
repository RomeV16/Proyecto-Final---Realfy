import { AsyncLocalStorage } from 'async_hooks';
import { ClsService } from 'nestjs-cls';
import { TenantCron } from './tenant-cron';
import { TenantContextService } from '../tenant/tenant-context.service';
import { RequestContextService } from '../logger/request-context.service';

/**
 * `TenantCron` real sobre un CLS real y las inmobiliarias dadas, para las
 * pruebas de los procesos programados: la función de cada vuelta corre dentro
 * de un contexto con la inmobiliaria fijada, igual que en producción.
 */
export function makeTenantCron(
  tenants: Array<{ id: string; name: string }>,
  existingPrisma?: { baseClient: { tenant: { findMany: jest.Mock } } },
) {
  const cls = new ClsService(new AsyncLocalStorage());
  const tenantContext = new TenantContextService(cls);
  const prisma = (existingPrisma ?? {
    baseClient: { tenant: { findMany: jest.fn().mockResolvedValue(tenants) } },
  }) as any;
  const tenantCron = new TenantCron(prisma, cls, tenantContext, new RequestContextService(cls));
  return { tenantCron, tenantContext, cls, prisma };
}
