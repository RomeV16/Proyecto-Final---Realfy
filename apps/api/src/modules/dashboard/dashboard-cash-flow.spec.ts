import { DashboardCacheService } from './dashboard-cache.service';
import { DashboardService } from './dashboard.service';

/**
 * Flujo de caja del panel: los egresos son los pagos a los locadores de la
 * cuenta corriente (ADR-0009) más las rendiciones viejas depositadas.
 */
describe('DashboardService.getCashFlow', () => {
  function build() {
    const client: any = {
      payment: {
        findMany: jest.fn().mockResolvedValue([{ amount: '100000.00', paidAt: new Date('2026-03-05T12:00:00Z') }]),
      },
      ownerLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([
          { amount: '-60000.00', date: new Date('2026-03-15T00:00:00Z') },
          { amount: '-5000.00', date: new Date('2026-04-02T00:00:00Z') },
        ]),
      },
      ownerRendicion: {
        findMany: jest.fn().mockResolvedValue([{ netDeposit: '20000.00', depositedAt: new Date('2026-03-20T00:00:00Z') }]),
      },
    };
    const service = new DashboardService({ client } as any, new DashboardCacheService());
    return { service, client };
  }

  it('suma como egreso los pagos al locador y las rendiciones históricas depositadas', async () => {
    const { service, client } = build();
    const rows = await service.getCashFlow(
      'tenant-1',
      { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-04-30T00:00:00Z') },
      'month',
    );
    expect(rows).toEqual([
      { period: '2026-03', inflow: 100000, outflow: 80000, net: 20000 },
      { period: '2026-04', inflow: 0, outflow: 5000, net: -5000 },
    ]);
    const where = client.ownerLedgerEntry.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 'tenant-1', type: { in: ['Transferencia', 'EntregaEfectivo'] } });
  });
});
