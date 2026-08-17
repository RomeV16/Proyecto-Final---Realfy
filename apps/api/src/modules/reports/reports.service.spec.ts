import { BadRequestException } from '@nestjs/common';
import { LeadStatus, RendicionStatus } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ReportsService } from './reports.service';

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockPrismaService() {
  return {
    client: {
      ownerRendicion: { findMany: jest.fn() },
      payment: { findMany: jest.fn() },
      liquidacion: { findMany: jest.fn() },
      pipeline: { findMany: jest.fn() },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
  } as unknown as TenantContextService;
}

const OWNER_ID = 'a1111111-1111-4111-8111-111111111111';
const CONTRACT_ID = 'b2222222-2222-4222-8222-222222222222';
const PIPELINE_ID = 'c3333333-3333-4333-8333-333333333333';

/** Un pago con su liquidación pagada y el contrato/propiedad asociados. */
function payment(opts: {
  propertyId: string;
  amount: string;
  title?: string;
  commission?: { percentage?: string; fixedAmount?: string } | null;
  comprobantes?: Array<{ impTotal: string }>;
  paidAt?: Date;
}) {
  return {
    amount: opts.amount,
    paidAt: opts.paidAt ?? new Date('2026-03-10T12:00:00Z'),
    comprobantes: opts.comprobantes ?? [],
    liquidacion: {
      contract: {
        property: { id: opts.propertyId, title: opts.title ?? 'Propiedad', street: null },
        commission: opts.commission ?? null,
      },
    },
  };
}

function rendicion(opts: {
  period: Date;
  rentCollected?: string;
  commissionAmount?: string;
  adminFeeAmount?: string;
  deductionTotal?: string;
  netDeposit?: string;
  propertyTitle?: string;
  owner?: { firstName: string; lastName: string } | null;
  commissionType?: string;
  depositedAt?: Date | null;
}) {
  return {
    period: opts.period,
    rentCollected: opts.rentCollected ?? '0',
    commissionAmount: opts.commissionAmount ?? '0',
    adminFeeAmount: opts.adminFeeAmount ?? '0',
    deductionTotal: opts.deductionTotal ?? '0',
    netDeposit: opts.netDeposit ?? '0',
    depositedAt: opts.depositedAt ?? null,
    lineItems: [],
    owner: opts.owner ?? null,
    contract: {
      property: { title: opts.propertyTitle ?? 'Propiedad', street: null },
      commission: opts.commissionType ? { type: opts.commissionType } : null,
    },
  };
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new ReportsService(prisma as any, tenantContext as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Estado de cuenta del propietario ─────────────────────────────────────

  describe('getOwnerStatement', () => {
    it('suma cobros, comisiones y depositos de todas las rendiciones', async () => {
      (prisma.client.ownerRendicion.findMany as jest.Mock).mockResolvedValue([
        rendicion({
          period: new Date('2026-01-01T00:00:00Z'),
          rentCollected: '100000.00',
          commissionAmount: '8000.00',
          adminFeeAmount: '2000.00',
          deductionTotal: '1500.50',
          netDeposit: '88499.50',
        }),
        rendicion({
          period: new Date('2026-02-01T00:00:00Z'),
          rentCollected: '100000.00',
          commissionAmount: '8000.00',
          adminFeeAmount: '2000.00',
          deductionTotal: '0.50',
          netDeposit: '89999.50',
        }),
      ]);

      const report = await service.getOwnerStatement({ ownerId: OWNER_ID });

      expect(report.type).toBe('ownerStatement');
      expect(report.rows).toHaveLength(2);
      expect(report.summary).toEqual({
        cobrado: '200000.00',
        comision: '16000.00',
        honorarios: '4000.00',
        deducciones: '1501.00',
        depositoNeto: '178499.00',
      });
    });

    it('filtra por propietario y rango de periodos', async () => {
      (prisma.client.ownerRendicion.findMany as jest.Mock).mockResolvedValue([]);

      await service.getOwnerStatement({
        ownerId: OWNER_ID,
        from: '2026-01-01',
        to: '2026-03-31',
      });

      const args = (prisma.client.ownerRendicion.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.tenantId).toBe('tenant-1');
      expect(args.where.ownerId).toBe(OWNER_ID);
      expect(args.where.period.gte).toEqual(new Date('2026-01-01'));
      expect(args.where.period.lte).toEqual(new Date('2026-03-31'));
    });

    it('rechaza filtros invalidos', async () => {
      await expect(service.getOwnerStatement({ ownerId: 'no-es-uuid' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.client.ownerRendicion.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Rentabilidad por propiedad ───────────────────────────────────────────

  describe('getPropertyProfitability', () => {
    it('agrupa los pagos por propiedad y calcula el ingreso neto', async () => {
      (prisma.client.payment.findMany as jest.Mock).mockResolvedValue([
        payment({
          propertyId: 'prop-1',
          title: 'Belgrano 100',
          amount: '100000.00',
          commission: { percentage: '8' },
          comprobantes: [{ impTotal: '121000.00' }],
        }),
        payment({
          propertyId: 'prop-1',
          title: 'Belgrano 100',
          amount: '50000.00',
          commission: { percentage: '8' },
        }),
        payment({
          propertyId: 'prop-2',
          title: 'Salta 200',
          amount: '80000.00',
          commission: { fixedAmount: '5000.00' },
        }),
      ]);

      const report = await service.getPropertyProfitability({});

      expect(report.rows).toHaveLength(2);
      const belgrano = report.rows.find((r) => r.propiedad === 'Belgrano 100')!;
      expect(belgrano.cobrado).toBe('150000.00');
      expect(belgrano.facturado).toBe('121000.00');
      expect(belgrano.comisiones).toBe('12000.00');
      expect(belgrano.ingresoNeto).toBe('138000.00');

      const salta = report.rows.find((r) => r.propiedad === 'Salta 200')!;
      expect(salta.comisiones).toBe('5000.00');
      expect(salta.ingresoNeto).toBe('75000.00');

      expect(report.summary).toEqual({
        cobrado: '230000.00',
        facturado: '121000.00',
        comisiones: '17000.00',
        ingresoNeto: '213000.00',
      });
    });

    it('ignora pagos sin propiedad asociada', async () => {
      (prisma.client.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: '1000.00', comprobantes: [], liquidacion: { contract: null } },
      ]);

      const report = await service.getPropertyProfitability({});

      expect(report.rows).toHaveLength(0);
      // Sin filas, el resumen queda en el acumulador inicial.
      expect(report.summary).toEqual({
        cobrado: '0',
        facturado: '0',
        comisiones: '0',
        ingresoNeto: '0',
      });
    });
  });

  // ─── Flujo de caja ────────────────────────────────────────────────────────

  describe('getCashFlow', () => {
    it('arma un renglon por mes del rango con ingresos, egresos y saldo', async () => {
      (prisma.client.payment.findMany as jest.Mock).mockResolvedValue([
        {
          amount: '60000.00',
          paidAt: new Date(2026, 0, 15),
          comprobantes: [{ impTotal: '72600.00' }],
        },
        { amount: '40000.00', paidAt: new Date(2026, 1, 10), comprobantes: [] },
      ]);
      (prisma.client.ownerRendicion.findMany as jest.Mock).mockResolvedValue([
        { netDeposit: '50000.00', depositedAt: new Date(2026, 1, 20), period: new Date(2026, 1, 1) },
      ]);

      const report = await service.getCashFlow({ from: '2026-01-01', to: '2026-03-31' });

      expect(report.rows).toHaveLength(3);
      expect(report.rows[0]).toMatchObject({
        ingresos: '60000.00',
        egresos: '0.00',
        facturado: '72600.00',
        saldoNeto: '60000.00',
      });
      expect(report.rows[1]).toMatchObject({
        ingresos: '40000.00',
        egresos: '50000.00',
        saldoNeto: '-10000.00',
      });
      expect(report.rows[2]).toMatchObject({ ingresos: '0.00', egresos: '0.00' });
      expect(report.summary).toEqual({
        ingresos: '100000.00',
        egresos: '50000.00',
        facturado: '72600.00',
        saldoNeto: '50000.00',
      });
    });

    it('toma como egresos solo las rendiciones depositadas', async () => {
      (prisma.client.payment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.client.ownerRendicion.findMany as jest.Mock).mockResolvedValue([]);

      await service.getCashFlow({ from: '2026-01-01', to: '2026-01-31' });

      const args = (prisma.client.ownerRendicion.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.status).toBe(RendicionStatus.Depositada);
      expect(args.where.tenantId).toBe('tenant-1');
    });
  });

  // ─── Resumen de comisiones ────────────────────────────────────────────────

  describe('getCommissionSummary', () => {
    it('suma comision mas honorarios por rendicion', async () => {
      (prisma.client.ownerRendicion.findMany as jest.Mock).mockResolvedValue([
        rendicion({
          period: new Date('2026-01-01T00:00:00Z'),
          commissionAmount: '8000.00',
          adminFeeAmount: '2000.00',
          propertyTitle: 'Belgrano 100',
          owner: { firstName: 'Ana', lastName: 'Diaz' },
          commissionType: 'FixedPercent',
        }),
        rendicion({
          period: new Date('2026-02-01T00:00:00Z'),
          commissionAmount: '7500.50',
          adminFeeAmount: '1000.00',
          propertyTitle: 'Belgrano 100',
          owner: { firstName: 'Ana', lastName: 'Diaz' },
          commissionType: 'FixedPercent',
        }),
      ]);

      const report = await service.getCommissionSummary({ contractId: CONTRACT_ID });

      expect(report.rows[0]).toMatchObject({
        propietario: 'Ana Diaz',
        tipoComision: 'FixedPercent',
        comision: '8000.00',
        honorarios: '2000.00',
        total: '10000.00',
      });
      expect(report.summary).toEqual({
        comision: '15500.50',
        honorarios: '3000.00',
        total: '18500.50',
      });
    });

    it('muestra un guion cuando la rendicion no tiene propietario cargado', async () => {
      (prisma.client.ownerRendicion.findMany as jest.Mock).mockResolvedValue([
        rendicion({ period: new Date('2026-01-01T00:00:00Z'), owner: null }),
      ]);

      const report = await service.getCommissionSummary({});

      expect(report.rows[0].propietario).toBe('—');
      expect(report.rows[0].tipoComision).toBe('—');
    });
  });

  // ─── Analitica del embudo ─────────────────────────────────────────────────

  describe('getPipelineAnalytics', () => {
    const DAY = 86400000;

    it('calcula tasa de conversion y promedio de dias por etapa', async () => {
      (prisma.client.pipeline.findMany as jest.Mock).mockResolvedValue([
        {
          name: 'Alquileres',
          stages: [
            {
              name: 'Contacto',
              leads: [
                { status: LeadStatus.Nuevo },
                { status: LeadStatus.Perdido },
                {
                  status: LeadStatus.Convertido,
                  createdAt: new Date('2026-01-01T00:00:00Z'),
                  convertedAt: new Date('2026-01-11T00:00:00Z'),
                },
                {
                  status: LeadStatus.Convertido,
                  createdAt: new Date('2026-01-01T00:00:00Z'),
                  convertedAt: new Date('2026-01-21T00:00:00Z'),
                },
              ],
            },
            { name: 'Visita', leads: [] },
          ],
        },
      ]);

      const report = await service.getPipelineAnalytics({});

      expect(report.rows[0]).toEqual({
        etapa: 'Alquileres — Contacto',
        leadsActuales: '4',
        convertidos: '2',
        perdidos: '1',
        tasaConversion: '50.0%',
        promedioConversionDias: '15',
      });
      // Una etapa sin leads no divide por cero.
      expect(report.rows[1]).toMatchObject({
        leadsActuales: '0',
        tasaConversion: '0.0%',
        promedioConversionDias: '0',
      });
      expect(report.summary).toEqual({
        totalLeads: '4',
        totalConvertidos: '2',
        tasaConversionGeneral: '50.0%',
      });
    });

    it('acumula el embudo de todos los pipelines del tenant', async () => {
      const converted = {
        status: LeadStatus.Convertido,
        createdAt: new Date(Date.now() - 5 * DAY),
        convertedAt: new Date(),
      };
      (prisma.client.pipeline.findMany as jest.Mock).mockResolvedValue([
        { name: 'Alquileres', stages: [{ name: 'Contacto', leads: [converted] }] },
        { name: 'Ventas', stages: [{ name: 'Contacto', leads: [{ status: LeadStatus.Nuevo }] }] },
      ]);

      const report = await service.getPipelineAnalytics({});

      expect(report.rows.map((r) => r.etapa)).toEqual([
        'Alquileres — Contacto',
        'Ventas — Contacto',
      ]);
      expect(report.summary).toEqual({
        totalLeads: '2',
        totalConvertidos: '1',
        tasaConversionGeneral: '50.0%',
      });
    });

    it('acota los leads al pipeline y al rango pedidos', async () => {
      (prisma.client.pipeline.findMany as jest.Mock).mockResolvedValue([]);

      await service.getPipelineAnalytics({
        pipelineId: PIPELINE_ID,
        from: '2026-01-01',
        to: '2026-01-31',
      });

      const args = (prisma.client.pipeline.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({ tenantId: 'tenant-1', id: PIPELINE_ID });
      const leadWhere = args.include.stages.include.leads.where;
      expect(leadWhere.tenantId).toBe('tenant-1');
      expect(leadWhere.createdAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-01-31'),
      });
    });
  });

  // ─── Morosidad ────────────────────────────────────────────────────────────

  describe('getMorosidad', () => {
    function liquidacion(opts: { dueDate: Date; total: string; inquilino?: boolean }) {
      return {
        dueDate: opts.dueDate,
        period: new Date('2026-01-01T00:00:00Z'),
        total: opts.total,
        currency: 'ARS',
        contract: {
          property: { title: 'Belgrano 100', street: null },
          persons: opts.inquilino
            ? [{ person: { firstName: 'Luis', lastName: 'Gomez' } }]
            : [],
        },
      };
    }

    it('acumula el total vencido y los dias de atraso', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-31T00:00:00Z'));
      (prisma.client.liquidacion.findMany as jest.Mock).mockResolvedValue([
        liquidacion({ dueDate: new Date('2026-03-01T00:00:00Z'), total: '120000.00', inquilino: true }),
        liquidacion({ dueDate: new Date('2026-03-21T00:00:00Z'), total: '80000.50' }),
      ]);

      const report = await service.getMorosidad({});

      expect(report.rows[0]).toMatchObject({
        inquilino: 'Luis Gomez',
        diasVencidos: '30',
        monto: '120000.00',
        moneda: 'ARS',
      });
      expect(report.rows[1]).toMatchObject({ inquilino: '—', diasVencidos: '10' });
      expect(report.summary).toEqual({
        totalVencido: '200000.50',
        cantidadVencidas: '2',
      });

      jest.useRealTimers();
    });

    it('solo mira liquidaciones enviadas o vencidas con vencimiento pasado', async () => {
      (prisma.client.liquidacion.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMorosidad({ contractId: CONTRACT_ID });

      const args = (prisma.client.liquidacion.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.status).toEqual({ in: ['Enviada', 'Vencida'] });
      expect(args.where.dueDate.lt).toBeInstanceOf(Date);
      expect(args.where.contractId).toBe(CONTRACT_ID);
      expect(args.where.contract.tenantId).toBe('tenant-1');
    });
  });
});
