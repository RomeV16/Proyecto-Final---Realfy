import { Test, TestingModule } from '@nestjs/testing';
import { ContractClosureMetricsSchema } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractClosureMetricsService } from './contract-closure-metrics.service';
import { toClosureFacts } from './contract-closure';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT_ID = 'con-1';

/**
 * Todo dato personal de las fixtures pasa por acá. Las pruebas de
 * seudonimización buscan cada uno de estos valores en lo que se manda al modelo.
 */
const PERSONAL_DATA = [
  'Lucía',
  'Fernández',
  'Lucía Fernández',
  'Ana',
  'Gómez',
  '20-31456789-4',
  'lucia.fernandez@example.com',
  '+54 9 11 5555-1234',
  'Av. Rivadavia 4820 3B',
];

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

/** Un contrato de dos años cortado nueve meses antes de lo pactado. */
const CONTRACT = {
  id: CONTRACT_ID,
  propertyId: 'prop-1',
  contractType: 'Alquiler',
  status: 'Rescindido',
  startDate: d('2024-03-01'),
  endDate: d('2026-03-01'),
  rentAmount: 320000,
  rentCurrency: 'ARS',
  closedAt: d('2025-12-01'),
  updatedAt: d('2026-01-20'),

  liquidaciones: [
    // En término: se pagó dos días antes del vencimiento.
    {
      id: 'liq-1',
      dueDate: d('2024-04-10'),
      total: 200000,
      status: 'Pagada',
      paidAt: d('2024-04-08'),
      payments: [{ amount: 200000, paidAt: d('2024-04-08') }],
    },
    // Con atraso: sin fecha de cierre, se toma la del pago.
    {
      id: 'liq-2',
      dueDate: d('2024-05-10'),
      total: 200000,
      status: 'Pagada',
      paidAt: null,
      payments: [{ amount: 200000, paidAt: d('2024-05-16') }],
    },
    // Justo el día del vencimiento: cuenta como puntual.
    {
      id: 'liq-3',
      dueDate: d('2024-06-10'),
      total: 200000,
      status: 'Pagada',
      paidAt: d('2024-06-10'),
      payments: [{ amount: 200000, paidAt: d('2024-06-10') }],
    },
    {
      id: 'liq-4',
      dueDate: d('2024-07-10'),
      total: 250000,
      status: 'Pagada',
      paidAt: d('2024-08-01'),
      payments: [{ amount: 250000, paidAt: d('2024-08-01') }],
    },
    // Sin cobrar al cierre.
    {
      id: 'liq-5',
      dueDate: d('2025-11-10'),
      total: 320000,
      status: 'Vencida',
      paidAt: null,
      payments: [],
    },
    // Anulada: nunca fue una obligación de pago, no entra en ninguna cuenta.
    {
      id: 'liq-6',
      dueDate: d('2025-01-10'),
      total: 100000,
      status: 'Anulada',
      paidAt: null,
      payments: [],
    },
  ],

  adjustments: [
    { previousAmount: 180000, newAmount: 230000, adjustmentDate: d('2024-09-01') },
    { previousAmount: 230000, newAmount: 320000, adjustmentDate: d('2025-03-01') },
  ],

  rendiciones: [
    { status: 'Depositada', netDeposit: 150000 },
    { status: 'Enviada', netDeposit: 160000 },
    // En borrador: todavía no salió hacia el propietario.
    { status: 'Borrador', netDeposit: 170000 },
  ],

  // Datos que la ficha necesita y el resumen no: viajan en la fila leída pero no
  // pueden aparecer del otro lado.
  property: { id: 'prop-1', title: 'Av. Rivadavia 4820 3B' },
  persons: [
    {
      role: 'Inquilino',
      person: {
        firstName: 'Lucía',
        lastName: 'Fernández',
        cuit: '20-31456789-4',
        email: 'lucia.fernandez@example.com',
        phone: '+54 9 11 5555-1234',
      },
    },
    { role: 'Propietario', person: { firstName: 'Ana', lastName: 'Gómez' } },
  ],
};

const PENALTIES = [
  { amount: 15000, status: 'active' },
  { amount: 9000, status: 'active' },
  { amount: 5000, status: 'waived' },
];

const TICKETS = [
  {
    status: 'Resuelto',
    createdAt: d('2024-05-01'),
    resolvedAt: d('2024-05-04'),
    closedAt: null,
    costAmount: 30000,
  },
  // Cerrado sin `resolvedAt`: se mide contra la fecha de cierre.
  {
    status: 'Cerrado',
    createdAt: d('2024-09-01'),
    resolvedAt: null,
    closedAt: d('2024-09-06'),
    costAmount: null,
  },
  {
    status: 'Abierto',
    createdAt: d('2025-10-01'),
    resolvedAt: null,
    closedAt: null,
    costAmount: 12000,
  },
  {
    status: 'Cancelado',
    createdAt: d('2025-02-01'),
    resolvedAt: null,
    closedAt: null,
    costAmount: null,
  },
];

function buildPrismaMock() {
  return {
    client: {
      contract: { findFirst: jest.fn().mockResolvedValue(CONTRACT) },
      penalty: { findMany: jest.fn().mockResolvedValue(PENALTIES) },
      ticket: { findMany: jest.fn().mockResolvedValue(TICKETS) },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractClosureMetricsService', () => {
  let service: ContractClosureMetricsService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let module: TestingModule;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    module = await Test.createTestingModule({
      providers: [
        ContractClosureMetricsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ContractClosureMetricsService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('compute', () => {
    it('devuelve null si el contrato no existe en la inmobiliaria en sesion', async () => {
      prisma.client.contract.findFirst.mockResolvedValueOnce(null);

      await expect(service.compute(CONTRACT_ID)).resolves.toBeNull();
    });

    it('mide la vigencia efectiva contra el cierre real y no contra lo pactado', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.closureStatus).toBe('Rescindido');
      expect(metrics.closedOn).toBe(d('2025-12-01').toISOString());
      expect(metrics.durationMonths).toBe(21);
      expect(metrics.durationDays).toBe(640);
      expect(metrics.endedEarly).toBe(true);
    });

    it('toma la fecha de cierre registrada y no la ultima modificacion', async () => {
      // El contrato se editó en enero, después de haberse rescindido en
      // diciembre: la vigencia no puede moverse por eso.
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.closedOn).toBe(CONTRACT.closedAt.toISOString());
      expect(metrics.closedOn).not.toBe(CONTRACT.updatedAt.toISOString());
    });

    it('regenerar despues de una edicion posterior da la misma vigencia', async () => {
      const before = (await service.compute(CONTRACT_ID))!;

      prisma.client.contract.findFirst.mockResolvedValueOnce({
        ...CONTRACT,
        updatedAt: d('2026-02-28'),
      });
      const after = (await service.compute(CONTRACT_ID))!;

      expect(after.closedOn).toBe(before.closedOn);
      expect(after.durationMonths).toBe(before.durationMonths);
      expect(after.durationDays).toBe(before.durationDays);
    });

    it('sin fecha registrada infiere el cierre, para los contratos ya cerrados de antes', async () => {
      prisma.client.contract.findFirst.mockResolvedValueOnce({
        ...CONTRACT,
        closedAt: null,
        updatedAt: d('2025-12-01'),
      });

      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.closedOn).toBe(d('2025-12-01').toISOString());
      expect(metrics.durationMonths).toBe(21);
    });

    it('sin fecha registrada nunca infiere un cierre posterior a lo pactado', async () => {
      prisma.client.contract.findFirst.mockResolvedValueOnce({
        ...CONTRACT,
        status: 'Vencido',
        closedAt: null,
        updatedAt: d('2026-06-15'),
      });

      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.closedOn).toBe(CONTRACT.endDate.toISOString());
      expect(metrics.endedEarly).toBe(false);
    });

    it('separa los pagos puntuales de los pagos con atraso', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.billedCount).toBe(5);
      expect(metrics.paidCount).toBe(4);
      expect(metrics.onTimeCount).toBe(2);
      expect(metrics.lateCount).toBe(2);
      expect(metrics.unpaidCount).toBe(1);
      expect(metrics.onTimeRate).toBe(50);
    });

    it('promedia y acota el atraso sobre los pagos que llegaron tarde', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      // 6 días en liq-2 y 22 en liq-4.
      expect(metrics.averageDelayDays).toBe(14);
      expect(metrics.maxDelayDays).toBe(22);
    });

    it('deja la liquidacion anulada afuera de los importes', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.billedAmount).toBe(1170000);
      expect(metrics.collectedAmount).toBe(850000);
      expect(metrics.outstandingAmount).toBe(320000);
    });

    it('cuenta los punitorios vigentes aparte de los condonados', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.penaltyCount).toBe(2);
      expect(metrics.penaltyAmount).toBe(24000);
      expect(metrics.penaltyWaivedCount).toBe(1);
    });

    it('resume los reclamos y como se resolvieron', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.ticketCount).toBe(4);
      expect(metrics.ticketsResolved).toBe(2);
      expect(metrics.ticketsCancelled).toBe(1);
      expect(metrics.ticketsOpen).toBe(1);
      // 3 días en uno y 5 en el otro.
      expect(metrics.averageResolutionDays).toBe(4);
      expect(metrics.ticketCostAmount).toBe(42000);
    });

    it('solo mira los reclamos de la propiedad dentro de la vigencia', async () => {
      await service.compute(CONTRACT_ID);

      expect(prisma.client.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            propertyId: 'prop-1',
            createdAt: { gte: CONTRACT.startDate, lte: d('2025-12-01') },
          },
        }),
      );
    });

    it('reconstruye el recorrido del alquiler con los ajustes aplicados', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.adjustmentCount).toBe(2);
      expect(metrics.firstRent).toBe(180000);
      expect(metrics.lastRent).toBe(320000);
      expect(metrics.rentIncreasePct).toBe(77.8);
    });

    it('sin ajustes aplicados toma el alquiler vigente y no informa variacion', async () => {
      prisma.client.contract.findFirst.mockResolvedValueOnce({
        ...CONTRACT,
        adjustments: [],
      });

      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.adjustmentCount).toBe(0);
      expect(metrics.firstRent).toBe(320000);
      expect(metrics.lastRent).toBe(320000);
      expect(metrics.rentIncreasePct).toBe(0);
    });

    it('cuenta solo las rendiciones que salieron hacia el propietario', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.rendicionCount).toBe(2);
      expect(metrics.rendicionNetAmount).toBe(310000);
    });

    it('un contrato sin historial devuelve la grilla en cero y no rompe', async () => {
      prisma.client.contract.findFirst.mockResolvedValueOnce({
        ...CONTRACT,
        liquidaciones: [],
        adjustments: [],
        rendiciones: [],
      });
      prisma.client.penalty.findMany.mockResolvedValueOnce([]);
      prisma.client.ticket.findMany.mockResolvedValueOnce([]);

      const metrics = (await service.compute(CONTRACT_ID))!;

      expect(metrics.billedCount).toBe(0);
      expect(metrics.onTimeRate).toBe(0);
      expect(metrics.averageDelayDays).toBe(0);
      expect(metrics.averageResolutionDays).toBeNull();
      expect(metrics.outstandingAmount).toBe(0);
    });

    it('devuelve una grilla que valida contra el esquema compartido', async () => {
      const metrics = await service.compute(CONTRACT_ID);

      expect(ContractClosureMetricsSchema.safeParse(metrics).success).toBe(true);
    });
  });

  describe('toClosureFacts', () => {
    it('no deja pasar ningun dato personal', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;
      const serialized = JSON.stringify(toClosureFacts(metrics));

      for (const value of PERSONAL_DATA) {
        expect(serialized).not.toContain(value);
      }
    });

    it('no deja pasar los identificadores internos', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;
      const serialized = JSON.stringify(toClosureFacts(metrics));

      for (const id of [CONTRACT_ID, 'prop-1', 'liq-1', 'liq-5']) {
        expect(serialized).not.toContain(id);
      }
    });

    it('se limita a la lista explicita de campos permitidos', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;
      const facts = toClosureFacts(metrics);

      const allowed = new Set([
        'tipoDeContrato',
        'estadoDeCierre',
        'inicioDeVigencia',
        'finPactado',
        'cierreEfectivo',
        'mesesDeVigencia',
        'diasDeVigencia',
        'cerroAntesDeLoPactado',
        'moneda',
        'liquidacionesEmitidas',
        'liquidacionesCobradas',
        'pagosEnTermino',
        'pagosConAtraso',
        'liquidacionesSinCobrar',
        'porcentajeDePuntualidad',
        'atrasoPromedioEnDias',
        'atrasoMaximoEnDias',
        'montoFacturado',
        'montoCobrado',
        'montoPendiente',
        'punitoriosAplicados',
        'montoDePunitorios',
        'punitoriosCondonados',
        'reclamosRecibidos',
        'reclamosResueltos',
        'reclamosAnulados',
        'reclamosSinCerrar',
        'diasPromedioDeResolucion',
        'costoDeReclamos',
        'ajustesAplicados',
        'alquilerInicial',
        'alquilerFinal',
        'variacionDelAlquilerEnPorcentaje',
        'rendicionesEmitidas',
        'montoNetoRendido',
      ]);

      for (const key of Object.keys(facts)) {
        expect(allowed.has(key)).toBe(true);
      }
    });

    it('conserva las metricas que el modelo necesita para redactar', async () => {
      const metrics = (await service.compute(CONTRACT_ID))!;
      const facts = toClosureFacts(metrics);

      expect(facts.mesesDeVigencia).toBe(21);
      expect(facts.porcentajeDePuntualidad).toBe(50);
      expect(facts.atrasoMaximoEnDias).toBe(22);
      expect(facts.punitoriosAplicados).toBe(2);
      expect(facts.reclamosRecibidos).toBe(4);
      expect(facts.montoPendiente).toBe(320000);
    });
  });
});
