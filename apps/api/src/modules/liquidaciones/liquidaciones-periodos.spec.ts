import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from './liquidaciones.service';

jest.mock('./pdf.service', () => ({ PdfService: jest.fn() }));

/**
 * CP-131 (DEF-11): los períodos y vencimientos de las liquidaciones son
 * fechas UTC. Jest fija TZ=UTC; acá se fuerza la zona de Buenos Aires para
 * reproducir la máquina de un desarrollador o un servidor en hora local.
 */
describe('LiquidacionesService: períodos independientes de la zona horaria', () => {
  const previousTz = process.env.TZ;
  let service: LiquidacionesService;
  let client: any;

  beforeAll(() => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
  });

  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  beforeEach(() => {
    client = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c-1', rentAmount: '100000', rentCurrency: 'ARS', property: {} },
        ]),
      },
      liquidacion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') };
    service = new LiquidacionesService(
      { client } as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      {} as any,
      {} as any,
    );
  });

  it('el período y el vencimiento generados son el 1 y el 10 a medianoche UTC', async () => {
    await service.generate({ month: 3, year: 2025 });

    const data = client.liquidacion.create.mock.calls[0][0].data;
    expect(data.period.toISOString()).toBe('2025-03-01T00:00:00.000Z');
    expect(data.dueDate.toISOString()).toBe('2025-03-10T00:00:00.000Z');
    expect(client.liquidacion.findFirst.mock.calls[0][0].where.period.toISOString()).toBe(
      '2025-03-01T00:00:00.000Z',
    );
  });

  it('el filtro de mes y año busca el 1 del mes a medianoche UTC', async () => {
    await service.findAll({ month: 2, year: 2025 });

    const where = client.liquidacion.findMany.mock.calls[0][0].where;
    expect(where.period.toISOString()).toBe('2025-02-01T00:00:00.000Z');
  });

  it('el filtro de solo año cubre de enero a enero en UTC', async () => {
    await service.findAll({ year: 2025 });

    const where = client.liquidacion.findMany.mock.calls[0][0].where;
    expect(where.period.gte.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(where.period.lt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
