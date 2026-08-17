import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DailyContextService } from './daily-context.service';
import { toModelFacts, type DailyContextItem } from './daily-context';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-17T12:00:00.000Z');

/**
 * Todo dato personal de las fixtures pasa por acá. Las pruebas de
 * seudonimización buscan cada uno de estos valores en lo que se manda al modelo.
 */
const PERSONAL_DATA = [
  'Lucía',
  'Fernández',
  'Lucía Fernández',
  'Marcos',
  'Peralta',
  'Ana',
  'Gómez',
  'Diego',
  'Suárez',
  '20-31456789-4',
  'lucia.fernandez@example.com',
  '+54 9 11 5555-1234',
  'Av. Rivadavia 4820 3B',
  'Güemes 1120',
  'Salta 233',
];

const LIQUIDACIONES = [
  {
    id: 'liq-1',
    period: new Date('2026-07-01T00:00:00.000Z'),
    dueDate: new Date('2026-07-10T12:00:00.000Z'),
    total: 250000,
    currency: 'ARS',
    status: 'Vencida',
    contract: {
      property: { title: 'Av. Rivadavia 4820 3B' },
      persons: [
        { role: 'Inquilino', person: { firstName: 'Lucía', lastName: 'Fernández' } },
        { role: 'Propietario', person: { firstName: 'Ana', lastName: 'Gómez' } },
      ],
    },
  },
  {
    id: 'liq-2',
    period: new Date('2026-08-01T00:00:00.000Z'),
    dueDate: new Date('2026-08-25T12:00:00.000Z'),
    total: 90000,
    currency: 'ARS',
    status: 'Enviada',
    contract: {
      property: { title: 'Güemes 1120' },
      persons: [{ role: 'Inquilino', person: { firstName: 'Marcos', lastName: 'Peralta' } }],
    },
  },
];

const CONTRACTS = [
  {
    id: 'con-1',
    endDate: new Date('2026-09-01T12:00:00.000Z'),
    rentAmount: 180000,
    rentCurrency: 'ARS',
    status: 'Activo',
    property: { title: 'Salta 233' },
    persons: [{ role: 'Inquilino', person: { firstName: 'Ana', lastName: 'Gómez' } }],
  },
];

const TICKETS = [
  {
    id: 'tk-1',
    title: 'Pérdida de agua en el baño',
    priority: 'Urgente',
    status: 'Abierto',
    slaDeadline: new Date('2026-08-16T12:00:00.000Z'),
    createdAt: new Date('2026-08-16T08:00:00.000Z'),
    assignedToUserId: null,
    providerId: null,
    property: { title: 'Salta 233' },
  },
  {
    id: 'tk-2',
    title: 'Cambio de cerradura',
    priority: 'Media',
    status: 'Asignado',
    slaDeadline: new Date('2026-08-30T12:00:00.000Z'),
    createdAt: new Date('2026-08-15T12:00:00.000Z'),
    assignedToUserId: 'usr-1',
    providerId: null,
    property: { title: 'Güemes 1120' },
  },
];

const LEADS = [
  {
    id: 'led-1',
    status: 'Contactado',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    lastContactAt: new Date('2026-08-01T12:00:00.000Z'),
    budget: 300000,
    budgetCurrency: 'ARS',
    person: { firstName: 'Diego', lastName: 'Suárez' },
    property: { title: 'Av. Rivadavia 4820 3B' },
  },
  {
    id: 'led-2',
    status: 'Nuevo',
    createdAt: new Date('2026-08-15T12:00:00.000Z'),
    lastContactAt: null,
    budget: null,
    budgetCurrency: 'ARS',
    person: { firstName: 'Marcos', lastName: 'Peralta' },
    property: null,
  },
];

function buildPrismaMock() {
  return {
    client: {
      liquidacion: { findMany: jest.fn().mockResolvedValue(LIQUIDACIONES) },
      contract: { findMany: jest.fn().mockResolvedValue(CONTRACTS) },
      ticket: { findMany: jest.fn().mockResolvedValue(TICKETS) },
      lead: { findMany: jest.fn().mockResolvedValue(LEADS) },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DailyContextService', () => {
  let service: DailyContextService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let module: TestingModule;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    module = await Test.createTestingModule({
      providers: [DailyContextService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DailyContextService);
  });

  afterEach(async () => {
    await module.close();
  });

  function itemFor(items: DailyContextItem[], ref: string): DailyContextItem {
    const item = items.find((i) => i.ref === ref);
    expect(item).toBeDefined();
    return item!;
  }

  describe('build', () => {
    it('reúne los cuatro frentes con una referencia opaca por item', async () => {
      const context = await service.build(NOW);

      expect(context.items.map((i) => i.ref)).toEqual(['C1', 'C2', 'R1', 'V1', 'L1']);
      expect(context.items.map((i) => i.kind)).toEqual([
        'cobranza',
        'cobranza',
        'reclamo',
        'contrato',
        'lead',
      ]);
      expect(context.generatedAt).toBe(NOW.toISOString());
    });

    it('ordena las cobranzas por atraso y calcula los días vencidos', async () => {
      const { items } = await service.build(NOW);

      const first = itemFor(items, 'C1');
      expect(first.entityId).toBe('liq-1');
      expect(first.daysOverdue).toBe(38);
      expect(first.amount).toBe(250000);
      expect(first.status).toBe('Vencida');

      // Una liquidación enviada que todavía no venció no acumula atraso.
      expect(itemFor(items, 'C2').daysOverdue).toBe(0);
    });

    it('mide el exceso de SLA y la falta de responsable en los reclamos', async () => {
      const { items } = await service.build(NOW);

      const claim = itemFor(items, 'R1');
      expect(claim.entityId).toBe('tk-1');
      expect(claim.slaHoursOverdue).toBe(24);
      expect(claim.unassigned).toBe(true);
      expect(claim.ticketPriority).toBe('Urgente');
    });

    it('deja afuera los reclamos en plazo y con responsable', async () => {
      const { items } = await service.build(NOW);

      expect(items.some((i) => i.entityId === 'tk-2')).toBe(false);
    });

    it('calcula la cercanía del vencimiento de los contratos', async () => {
      const { items } = await service.build(NOW);

      const expiry = itemFor(items, 'V1');
      expect(expiry.entityId).toBe('con-1');
      expect(expiry.daysToDue).toBe(15);
      expect(expiry.amount).toBe(180000);
    });

    it('sólo toma los leads que pasaron el umbral sin contacto', async () => {
      const { items } = await service.build(NOW);

      const lead = itemFor(items, 'L1');
      expect(lead.entityId).toBe('led-1');
      expect(lead.daysSinceContact).toBe(16);
      // led-2 se creó hace dos días: todavía no es un pendiente.
      expect(items.some((i) => i.entityId === 'led-2')).toBe(false);
    });

    it('agrega los totales de la cartera', async () => {
      const { totals } = await service.build(NOW);

      expect(totals).toEqual({
        overdueAmount: 250000,
        pendingAmount: 90000,
        overdueCollections: 1,
        openTickets: 2,
        expiringContracts: 1,
        staleLeads: 1,
      });
    });

    it('guarda el título y la contraparte para rehidratar después', async () => {
      const { items } = await service.build(NOW);

      const first = itemFor(items, 'C1');
      expect(first.title).toBe('Av. Rivadavia 4820 3B');
      expect(first.subtitle).toContain('Lucía Fernández');
      expect(itemFor(items, 'L1').subtitle).toBe('Diego Suárez');
    });
  });

  describe('toModelFacts', () => {
    it('no deja pasar ningún dato personal', async () => {
      const { items } = await service.build(NOW);
      const serialized = JSON.stringify(toModelFacts(items));

      for (const value of PERSONAL_DATA) {
        expect(serialized).not.toContain(value);
      }
    });

    it('no deja pasar los identificadores internos ni los títulos', async () => {
      const { items } = await service.build(NOW);
      const serialized = JSON.stringify(toModelFacts(items));

      for (const item of items) {
        expect(serialized).not.toContain(item.entityId);
        expect(serialized).not.toContain(item.title);
      }
    });

    it('se limita a la referencia opaca y a los datos objetivos', async () => {
      const { items } = await service.build(NOW);
      const facts = toModelFacts(items);

      const allowed = new Set([
        'ref',
        'tipo',
        'estado',
        'importe',
        'moneda',
        'diasDeAtraso',
        'diasParaVencer',
        'horasFueraDeSla',
        'sinResponsable',
        'prioridad',
        'diasSinContacto',
      ]);

      for (const fact of facts) {
        for (const key of Object.keys(fact)) {
          expect(allowed.has(key)).toBe(true);
        }
      }
    });

    it('conserva los datos objetivos que el modelo necesita para decidir', async () => {
      const { items } = await service.build(NOW);
      const facts = toModelFacts(items);

      expect(facts[0]).toEqual({
        ref: 'C1',
        tipo: 'cobranza',
        estado: 'Vencida',
        importe: 250000,
        moneda: 'ARS',
        diasDeAtraso: 38,
      });
      expect(facts.find((f) => f.ref === 'R1')).toEqual({
        ref: 'R1',
        tipo: 'reclamo',
        estado: 'Abierto',
        horasFueraDeSla: 24,
        sinResponsable: true,
        prioridad: 'Urgente',
      });
    });
  });
});
