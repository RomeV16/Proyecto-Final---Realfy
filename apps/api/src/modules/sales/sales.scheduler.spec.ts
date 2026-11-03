import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { SalesScheduler } from './sales.scheduler';

const today = new Date(Date.UTC(2026, 10, 10));

describe('SalesScheduler', () => {
  it('vence las reservas de cada inmobiliaria dentro de su contexto y suma lo vencido', async () => {
    const { tenantCron, tenantContext } = makeTenantCron([
      { id: 't1', name: 'Uno' },
      { id: 't2', name: 'Dos' },
    ]);
    const seen: string[] = [];
    const deposits = {
      expireReservations: jest.fn().mockImplementation(async () => {
        seen.push(tenantContext.getTenantId()!);
        return 2;
      }),
    };
    const scheduler = new SalesScheduler(deposits as any, tenantCron);
    await expect(scheduler.expireForAllTenants(today)).resolves.toEqual({ tenantsProcessed: 2, tenantsFailed: 0, expired: 4 });
    expect(seen).toEqual(['t1', 't2']);
    expect(deposits.expireReservations).toHaveBeenCalledWith(today);
  });

  it('el error de una inmobiliaria no corta a las demás', async () => {
    const { tenantCron } = makeTenantCron([
      { id: 't1', name: 'Uno' },
      { id: 't2', name: 'Dos' },
    ]);
    const deposits = { expireReservations: jest.fn().mockRejectedValueOnce(new Error('falló')).mockResolvedValueOnce(1) };
    const scheduler = new SalesScheduler(deposits as any, tenantCron);
    await expect(scheduler.expireForAllTenants(today)).resolves.toEqual({ tenantsProcessed: 1, tenantsFailed: 1, expired: 1 });
  });

  it('la ejecución programada corre protegida', async () => {
    const { tenantCron } = makeTenantCron([{ id: 't1', name: 'Uno' }]);
    const deposits = { expireReservations: jest.fn().mockResolvedValue(0) };
    const scheduler = new SalesScheduler(deposits as any, tenantCron);
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await scheduler.handleDailyExpiry();
    } finally {
      process.env.NODE_ENV = env;
    }
    expect(deposits.expireReservations).toHaveBeenCalledTimes(1);
  });
});
