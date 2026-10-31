import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

jest.mock('./rendition-pdf.service', () => ({
  RenditionPdfService: jest.fn(),
}));

import { RenditionsService } from './renditions.service';

/**
 * CP-131 (DEF-11): el filtro por mes y año de las rendiciones es UTC aunque el
 * proceso corra en hora de Buenos Aires.
 */
describe('RenditionsService: filtro de período independiente de la zona horaria', () => {
  const previousTz = process.env.TZ;
  let service: RenditionsService;
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
      ownerRendicion: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new RenditionsService(
      { client } as unknown as PrismaService,
      { getTenantId: jest.fn().mockReturnValue('tenant-1') } as unknown as TenantContextService,
      {} as any,
      {} as any,
    );
  });

  it('mes y año: el 1 del mes a medianoche UTC', async () => {
    await service.findAll({ month: 2, year: 2025 });

    const where = client.ownerRendicion.findMany.mock.calls[0][0].where;
    expect(where.period.toISOString()).toBe('2025-02-01T00:00:00.000Z');
  });

  it('solo año: de enero a enero en UTC', async () => {
    await service.findAll({ year: 2025 });

    const where = client.ownerRendicion.findMany.mock.calls[0][0].where;
    expect(where.period.gte.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(where.period.lt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
