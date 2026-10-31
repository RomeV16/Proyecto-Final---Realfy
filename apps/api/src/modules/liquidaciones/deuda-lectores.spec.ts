import { DashboardService } from '../dashboard/dashboard.service';
import { PaymentsService } from '../payments/payments.service';
import { DailyContextService } from '../ai/daily-context.service';
import { ReportsService } from '../reports/reports.service';
import { PenaltiesController } from '../penalties/penalties.controller';

/**
 * CP-139 (DEF-19): los cinco lectores de la deuda (resumen de pagos, panel,
 * contexto diario, reporte de morosidad y morosos de punitorios) usan el mismo
 * criterio: saldo pendiente (total menos pagos) de las liquidaciones por cobrar.
 *
 * Escenario común, con "hoy" el 17/08/2026:
 *   L1 Vencida, total 250000.00, pagó 100000.00 (saldo 150000.00), venció el 10/07
 *   L2 Enviada, total  90000.00, sin pagos       (saldo  90000.00), vence el 25/08
 *   L3 Enviada, total  60000.50, pagó 10000.25   (saldo  50000.25), venció el 05/08
 *   L4 Pagada,  total  70000.00, pagó 70000.00   (saldo 0)
 */
const NOW = new Date('2026-08-17T12:00:00.000Z');

const persons = [
  { role: 'Inquilino', person: { id: 'per-1', firstName: 'Lucía', lastName: 'Fernández' } },
];
const contract = { id: 'con-1', property: { id: 'prop-1', title: 'Depto Demo' }, persons };

const L1 = {
  id: 'liq-1',
  contractId: 'con-1',
  period: new Date('2026-07-01T00:00:00.000Z'),
  dueDate: new Date('2026-07-10T00:00:00.000Z'),
  total: '250000.00',
  currency: 'ARS',
  status: 'Vencida',
  payments: [{ amount: '100000.00' }],
  penalties: [],
  contract,
};
const L2 = {
  id: 'liq-2',
  contractId: 'con-1',
  period: new Date('2026-08-01T00:00:00.000Z'),
  dueDate: new Date('2026-08-25T00:00:00.000Z'),
  total: '90000.00',
  currency: 'ARS',
  status: 'Enviada',
  payments: [],
  penalties: [],
  contract,
};
const L3 = {
  id: 'liq-3',
  contractId: 'con-1',
  period: new Date('2026-08-01T00:00:00.000Z'),
  dueDate: new Date('2026-08-05T00:00:00.000Z'),
  total: '60000.50',
  currency: 'ARS',
  status: 'Enviada',
  payments: [{ amount: '10000.25' }],
  penalties: [],
  contract,
};
const L4 = {
  id: 'liq-4',
  contractId: 'con-1',
  period: new Date('2026-08-01T00:00:00.000Z'),
  dueDate: new Date('2026-08-10T00:00:00.000Z'),
  total: '70000.00',
  currency: 'ARS',
  status: 'Pagada',
  payments: [{ amount: '70000.00' }],
  penalties: [],
  contract,
};
const ALL = [L1, L2, L3, L4];

/** Filtra por `where.status` como lo haría la base. */
function findMany(rows: any[]) {
  return jest.fn(async (args: any = {}) => {
    const status = args.where?.status;
    const allowed: string[] | null =
      status === undefined ? null : typeof status === 'string' ? [status] : status.in;
    return rows.filter((l) => !allowed || allowed.includes(l.status));
  });
}

describe('Lectores de deuda: escenario con pago parcial y liquidación vencida', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resumen de pagos (PaymentsService.debtSummary)', async () => {
    const prisma = { client: { liquidacion: { findMany: findMany(ALL) } } } as any;
    const summary = await new PaymentsService(prisma).debtSummary();

    expect(summary.pendiente).toEqual({ count: 2, monto: 150001 });
    expect(summary.vencida).toEqual({ count: 1, monto: 250000 });
    expect(summary.items.map((i: any) => i.id)).toEqual(['liq-1', 'liq-2', 'liq-3']);
  });

  it('panel (DashboardService.getStats)', async () => {
    const prisma = {
      client: {
        property: { findMany: jest.fn().mockResolvedValue([]) },
        contract: { findMany: jest.fn().mockResolvedValue([]) },
        liquidacion: { findMany: findMany(ALL) },
        ticket: { findMany: jest.fn().mockResolvedValue([]) },
        service: { count: jest.fn().mockResolvedValue(0) },
      },
    } as any;
    const stats: any = await new DashboardService(prisma, {} as any).getStats();

    expect(stats.collections).toEqual({
      total: 470001,
      pagada: 70000,
      pendiente: 150001,
      vencida: 250000,
      rate: 15,
    });
    expect(stats.delinquency).toEqual({ overdueAmount: 250000, rate: 53 });
    expect(stats.pendingLiquidaciones).toBe(3);
    expect(stats.agenda.collections.map((p: any) => [p.id, p.amount])).toEqual([
      ['liq-1', 250000],
      ['liq-3', 60001],
      ['liq-2', 90000],
    ]);
  });

  it('contexto diario (DailyContextService.build)', async () => {
    const outstanding = [L1, L2, L3];
    const prisma = {
      client: {
        liquidacion: { findMany: findMany(outstanding) },
        contract: { findMany: jest.fn().mockResolvedValue([]) },
        ticket: { findMany: jest.fn().mockResolvedValue([]) },
        lead: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
    const ctx = await new DailyContextService(prisma).build(NOW);

    expect(ctx.totals.overdueAmount).toBe(250000);
    expect(ctx.totals.pendingAmount).toBe(150001);
    expect(ctx.totals.overdueCollections).toBe(1);
    const cobranzas = ctx.items.filter((i) => i.kind === 'cobranza');
    expect(cobranzas.map((i) => i.amount)).toEqual([250000, 60001, 90000]);
  });

  it('reporte de morosidad (ReportsService.getMorosidad)', async () => {
    const prisma = { client: { liquidacion: { findMany: findMany([L1, L3]) } } } as any;
    const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') } as any;
    const report = await new ReportsService(prisma, tenantContext).getMorosidad({});

    expect(report.rows.map((r: any) => r.monto)).toEqual(['250000.00', '60000.50']);
    expect(report.summary).toEqual({ totalVencido: '310000.50', cantidadVencidas: '2' });
  });

  it('morosos de punitorios (PenaltiesController.getDelinquentTenants)', async () => {
    const prisma = { baseClient: { liquidacion: { findMany: findMany([L1, L3]) } } } as any;
    const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') } as any;
    const controller = new PenaltiesController(prisma, tenantContext, {} as any, {} as any, {} as any);
    const morosos = await controller.getDelinquentTenants();

    expect(morosos).toHaveLength(1);
    expect(morosos[0].totalDebt).toBe('310000.50');
  });
});
