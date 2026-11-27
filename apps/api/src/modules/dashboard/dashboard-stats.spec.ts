import { DashboardService } from './dashboard.service';

/**
 * Indicadores de `GET /dashboard/stats` que dependen del día: vencimientos de
 * contrato contados contra el día calendario de Buenos Aires y la serie de
 * ingresos de los últimos seis meses.
 */
const contrato = (id: string, endDate: string) => ({
  id,
  rentAmount: '100000.00',
  endDate: new Date(`${endDate}T00:00:00.000Z`),
  actualEndDate: null,
  property: { title: `Depto ${id}` },
  persons: [{ role: 'Inquilino', person: { firstName: 'Ana', lastName: 'Paz' } }],
});

const liquidacion = (id: string, period: string, status: string, total: string) => ({
  id,
  period: new Date(`${period}-01T00:00:00.000Z`),
  dueDate: new Date(`${period}-10T00:00:00.000Z`),
  total,
  status,
  payments: status === 'Pagada' ? [{ amount: total }] : [],
  contract: { property: { title: 'Depto' } },
});

function build(contracts: any[], liquidaciones: any[]) {
  const prisma = {
    client: {
      property: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue(contracts) },
      liquidacion: { findMany: jest.fn().mockResolvedValue(liquidaciones) },
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      service: { count: jest.fn().mockResolvedValue(0) },
    },
  } as any;
  return new DashboardService(prisma, {} as any);
}

describe('DashboardService.getStats', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('vencimientos de contrato', () => {
    const contracts = [
      contrato('hoy', '2026-11-27'),
      contrato('dia-30', '2026-12-27'),
      contrato('dia-34', '2026-12-31'),
      contrato('dia-91', '2027-02-26'),
      contrato('ayer', '2026-11-26'),
    ];

    it('cuenta los días contra el día de Buenos Aires aunque en UTC ya sea mañana', async () => {
      // 27/11 a las 22:30 de Buenos Aires = 28/11 01:30 UTC.
      jest.useFakeTimers({ now: new Date('2026-11-28T01:30:00.000Z') });
      const stats = await build(contracts, []).getStats();

      expect(stats.agenda.expiring.map((e) => [e.id, e.daysLeft])).toEqual([
        ['hoy', 0],
        ['dia-30', 30],
        ['dia-34', 34],
      ]);
    });

    it('reparte en tramos disjuntos e incluye el contrato que vence hoy', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-27T15:00:00.000Z') });
      const stats = await build(contracts, []).getStats();

      expect(stats.expiringContracts).toEqual({ within30: 2, within60: 1, within90: 0 });
    });
  });

  describe('ingresos de los últimos seis meses', () => {
    it('no cuenta como esperado lo anulado', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-27T15:00:00.000Z') });
      const stats = await build(
        [],
        [
          liquidacion('l1', '2026-10', 'Pagada', '500000.00'),
          liquidacion('l2', '2026-10', 'Anulada', '300000.00'),
          liquidacion('l3', '2026-10', 'Vencida', '200000.00'),
        ],
      ).getStats();

      expect(stats.revenueTrend.map((m) => m.month)).toEqual(['Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov']);
      expect(stats.revenueTrend[4]).toEqual({ month: 'Oct', expected: 700000, collected: 500000 });
    });
  });

  describe('cobranzas del mes', () => {
    it('avisa de qué mes son y que no hay liquidaciones emitidas cuando el mes está vacío', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-27T15:00:00.000Z') });
      const stats = await build(
        [],
        [
          liquidacion('l1', '2026-10', 'Vencida', '726512.64'),
          liquidacion('l2', '2026-12', 'Borrador', '554791.47'),
        ],
      ).getStats();

      expect(stats.collections).toEqual({
        total: 726513,
        pagada: 0,
        pendiente: 0,
        vencida: 726513,
        rate: 0,
        period: '2026-11',
        count: 0,
      });
    });

    it('la mora también se informa contra lo que la cartera factura por mes', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-27T15:00:00.000Z') });
      const contracts = ['a', 'b', 'c', 'd'].map((id) => contrato(id, '2028-01-31'));
      const stats = await build(contracts, [liquidacion('l1', '2026-10', 'Vencida', '100000.00')]).getStats();

      // Sin liquidaciones en noviembre, `rate` da 100 %; contra el rent roll (400.000) es 25 %.
      expect(stats.delinquency).toEqual({ overdueAmount: 100000, rate: 100, rentRollRate: 25 });
    });

    it('cuenta las liquidaciones emitidas del mes en curso', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-27T15:00:00.000Z') });
      const stats = await build(
        [],
        [
          liquidacion('l1', '2026-11', 'Pagada', '300000.00'),
          liquidacion('l2', '2026-11', 'Enviada', '100000.00'),
          liquidacion('l3', '2026-11', 'Borrador', '100000.00'),
        ],
      ).getStats();

      expect(stats.collections).toMatchObject({ pagada: 300000, rate: 75, period: '2026-11', count: 2 });
    });
  });
});
