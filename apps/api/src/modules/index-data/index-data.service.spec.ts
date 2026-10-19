import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { IndexDataService, mergeVisibleRows } from './index-data.service';
import { TenantIsolationError } from '../../common/tenant/tenant-isolation.error';
import { IndexType } from '@realfy/shared';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockFindFirst = jest.fn();
const mockDelete = jest.fn();

// Escrituras y borrado por el cliente aislado; lecturas por el cliente base
// con filtro explícito propio + sistema (DEF-01).
const mockPrisma = {
  client: {
    indexData: {
      upsert: mockUpsert,
      findFirst: mockFindFirst,
      delete: mockDelete,
    },
  },
  baseClient: {
    indexData: {
      findMany: mockFindMany,
    },
  },
} as any;

const visible = { tenantId: { in: ['tenant-1', '__system__'] } };
const row = (overrides: Partial<any> = {}) => ({
  id: 'r',
  tenantId: 'tenant-1',
  indexType: IndexType.IPC,
  period: new Date('2025-01-01T00:00:00.000Z'),
  value: '1',
  ...overrides,
});

const mockTenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') } as any;

async function expectValidationError(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow(BadRequestException);
  await promise.catch((err: BadRequestException) => {
    expect((err.getResponse() as any).error).toBe('VALIDATION_ERROR');
  });
}

describe('IndexDataService', () => {
  let service: IndexDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantContext.getTenantId.mockReturnValue('tenant-1');
    service = new IndexDataService(mockPrisma, mockTenantContext);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockImplementation(async (args: any) => ({ id: 'row-1', ...args.create }));
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('CP-18: sin parámetros pagina con page 1 y limit 50 sobre las filas visibles', async () => {
      mockFindMany.mockResolvedValueOnce(
        Array.from({ length: 120 }, (_, i) => row({ id: `r${i}`, period: new Date(Date.UTC(2015, 0, 1 + i)) })),
      );

      const result = await service.findAll({});

      expect(mockFindMany).toHaveBeenCalledWith({
        where: visible,
        orderBy: { period: 'desc' },
      });
      expect(result).toMatchObject({ page: 1, limit: 50, total: 120, totalPages: 3 });
      expect(result.items).toHaveLength(50);
      expect(result.items[0].id).toBe('r0');
    });

    it('CP-18: sin inmobiliaria en contexto falla cerrado (ADR-0006)', async () => {
      mockTenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.findAll({})).rejects.toThrow(TenantIsolationError);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('CP-53 (unitario): una fila propia y una de sistema del mismo período cuentan una sola vez, gana la propia', async () => {
      mockFindMany.mockResolvedValueOnce([
        row({ id: 'sys', tenantId: '__system__', value: '2.0', source: 'indec' }),
        row({ id: 'own', value: '2.5', source: 'manual' }),
        row({ id: 'sys2', tenantId: '__system__', period: new Date('2025-02-01T00:00:00.000Z') }),
      ]);

      const result = await service.findAll({});

      expect(result.total).toBe(2);
      expect(result.items.map((r: any) => r.id)).toEqual(['own', 'sys2']);
    });

    it('CP-19: traduce los filtros de tipo y rango de período al where', async () => {
      await service.findAll({
        indexType: IndexType.ICL,
        periodFrom: '2025-01-01T00:00:00.000Z',
        periodTo: '2025-03-31T00:00:00.000Z',
        page: 2,
        limit: 10,
      });

      const args = mockFindMany.mock.calls[0][0];
      expect(args.where).toEqual({
        ...visible,
        indexType: IndexType.ICL,
        period: {
          gte: new Date('2025-01-01T00:00:00.000Z'),
          lte: new Date('2025-03-31T00:00:00.000Z'),
        },
      });
    });

    it('CP-19: con solo periodFrom no agrega cota superior', async () => {
      await service.findAll({ periodFrom: '2025-01-01T00:00:00.000Z' });

      expect(mockFindMany.mock.calls[0][0].where.period).toEqual({
        gte: new Date('2025-01-01T00:00:00.000Z'),
      });
    });

    it.each([
      ['page 0', { page: 0 }],
      ['limit 0', { limit: 0 }],
      ['limit 101', { limit: 101 }],
      ['page negativa', { page: -1 }],
    ])('CP-20 (límite inválido): %s responde VALIDATION_ERROR', async (_label, query) => {
      await expectValidationError(service.findAll(query));
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it.each([
      ['page 1', { page: 1 }, { page: 1, limit: 50, first: 'r0' }],
      ['limit 1', { limit: 1 }, { page: 1, limit: 1, first: 'r0' }],
      ['limit 100', { limit: 100 }, { page: 1, limit: 100, first: 'r0' }],
      ['valores como texto', { page: '3', limit: '20' }, { page: 3, limit: 20, first: 'r40' }],
    ])('CP-20 (límite válido): %s se acepta', async (_label, query, expected) => {
      mockFindMany.mockResolvedValueOnce(
        Array.from({ length: 120 }, (_, i) => row({ id: `r${i}`, period: new Date(Date.UTC(2015, 0, 1 + i)) })),
      );

      const result = await service.findAll(query);

      expect(result.page).toBe(expected.page);
      expect(result.limit).toBe(expected.limit);
      expect(result.items[0].id).toBe(expected.first);
    });

    it('CP-21: un período que no es fecha responde VALIDATION_ERROR con detalle', async () => {
      await expectValidationError(service.findAll({ periodFrom: 'no-es-fecha' }));
    });

    it('CP-21: un tipo de índice fuera del enumerado responde VALIDATION_ERROR', async () => {
      await expectValidationError(service.findAll({ indexType: 'DOLAR' }));
    });

    it('CP-18: total 0 devuelve totalPages 0', async () => {
      const result = await service.findAll({});

      expect(result.totalPages).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const valid = {
      indexType: IndexType.IPC,
      period: '2025-01-01T00:00:00.000Z',
      value: '4.200000',
      source: 'indec',
    };

    it('CP-22: un punto válido se inserta o actualiza por (inmobiliaria, tipo, período)', async () => {
      const record = await service.create(valid);

      expect(mockUpsert).toHaveBeenCalledWith({
        where: {
          tenantId_indexType_period: {
            tenantId: 'tenant-1',
            indexType: IndexType.IPC,
            period: new Date('2025-01-01T00:00:00.000Z'),
          },
        },
        update: { value: '4.200000', source: 'indec' },
        create: {
          tenantId: 'tenant-1',
          indexType: IndexType.IPC,
          period: new Date('2025-01-01T00:00:00.000Z'),
          value: '4.200000',
          source: 'indec',
        },
      });
      expect(record.id).toBe('row-1');
    });

    it('CP-22: sin fuente se guarda null', async () => {
      await service.create({ ...valid, source: undefined });

      expect(mockUpsert.mock.calls[0][0].create.source).toBeNull();
      expect(mockUpsert.mock.calls[0][0].update.source).toBeNull();
    });

    it.each([
      ['6 decimales', '1234.123456', true],
      ['7 decimales', '1234.1234567', false],
      ['negativo', '-0.5', true],
      ['entero', '7045', true],
      ['no numérico', 'abc', false],
      ['número en vez de texto', 1234.5, true],
    ])('CP-23 (precisión): value %s', async (_label, value, accepted) => {
      const promise = service.create({ ...valid, value });

      if (accepted) {
        await expect(promise).resolves.toBeDefined();
        expect(mockUpsert.mock.calls[0][0].create.value).toBe(String(value));
      } else {
        await expectValidationError(promise);
        expect(mockUpsert).not.toHaveBeenCalled();
      }
    });

    it('CP-24: un tipo de índice inválido responde VALIDATION_ERROR', async () => {
      await expectValidationError(service.create({ ...valid, indexType: 'DOLAR' }));
    });

    it('CP-24: una fuente de más de 200 caracteres se rechaza', async () => {
      await expectValidationError(service.create({ ...valid, source: 'x'.repeat(201) }));
    });

    it('CP-22: un error que no es de validación se propaga tal cual', async () => {
      mockUpsert.mockRejectedValueOnce(new Error('db down'));

      await expect(service.create(valid)).rejects.toThrow('db down');
    });
  });

  // ── createBulk ────────────────────────────────────────────────────────────

  describe('createBulk', () => {
    const item = (period: string) => ({ indexType: IndexType.ICL, period, value: '31.49' });

    it('CP-25: un cuerpo que no es lista responde VALIDATION_ERROR', async () => {
      await expectValidationError(service.createBulk({ indexType: IndexType.ICL }));
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('CP-25 (límite): la lista vacía devuelve lista vacía sin escribir', async () => {
      await expect(service.createBulk([])).resolves.toEqual([]);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('CP-25: tres puntos producen tres upserts en orden', async () => {
      const result = await service.createBulk([
        item('2025-01-01T00:00:00.000Z'),
        item('2025-01-02T00:00:00.000Z'),
        item('2025-01-03T00:00:00.000Z'),
      ]);

      expect(result).toHaveLength(3);
      expect(mockUpsert).toHaveBeenCalledTimes(3);
      expect(mockUpsert.mock.calls.map((c) => c[0].create.period.toISOString())).toEqual([
        '2025-01-01T00:00:00.000Z',
        '2025-01-02T00:00:00.000Z',
        '2025-01-03T00:00:00.000Z',
      ]);
    });

    it('CP-25: un ítem inválido corta la carga en ese punto', async () => {
      await expectValidationError(
        service.createBulk([item('2025-01-01T00:00:00.000Z'), { indexType: 'DOLAR' }]),
      );
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('CP-26: un identificador inexistente responde NotFoundException', async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      await expect(service.delete('nope')).rejects.toThrow(NotFoundException);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('CP-26: un registro existente se borra y responde deleted: true', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: 'row-1',
        indexType: IndexType.IPC,
        period: new Date('2025-01-01T00:00:00.000Z'),
      });
      mockDelete.mockResolvedValueOnce({});

      await expect(service.delete('row-1')).resolves.toEqual({ deleted: true });
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'row-1' } });
    });
  });

  // ── getForPeriod ──────────────────────────────────────────────────────────

  it('CP-27: getForPeriod consulta el rango inclusivo ordenado ascendente', async () => {
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2025-03-01T00:00:00.000Z');
    mockFindMany.mockResolvedValueOnce([row({ value: '1' })]);

    const rows = await service.getForPeriod(IndexType.IPC, start, end);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { ...visible, indexType: IndexType.IPC, period: { gte: start, lte: end } },
      orderBy: { period: 'asc' },
    });
    expect(rows.map((r) => r.value)).toEqual(['1']);
  });

  it('CP-27: getForPeriod acepta inmobiliaria y cliente explícitos para barridos y transacciones', async () => {
    const txFindMany = jest.fn().mockResolvedValue([]);
    mockTenantContext.getTenantId.mockReturnValue(undefined);

    await service.getForPeriod(IndexType.ICL, new Date(0), new Date(1), {
      tenantId: 'tenant-9',
      client: { indexData: { findMany: txFindMany } },
    });

    expect(txFindMany.mock.calls[0][0].where.tenantId).toEqual({ in: ['tenant-9', '__system__'] });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('mergeVisibleRows: la fila propia reemplaza a la de sistema aunque llegue después', () => {
    const sys = row({ id: 'sys', tenantId: '__system__' });
    const own = row({ id: 'own' });

    expect(mergeVisibleRows([sys, own], 'tenant-1').map((r) => r.id)).toEqual(['own']);
    expect(mergeVisibleRows([own, sys], 'tenant-1').map((r) => r.id)).toEqual(['own']);
  });

  // ── findLatest ────────────────────────────────────────────────────────────

  describe('findLatest', () => {
    it('CP-28: incluye solo los tipos que tienen al menos una fila', async () => {
      const latestIpc = row({ id: 'ipc-1', value: '4.2' });
      mockFindMany.mockImplementation(async ({ where }: any) =>
        where.indexType === IndexType.IPC ? [latestIpc] : [],
      );

      const result = await service.findLatest();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ indexType: IndexType.IPC, latest: latestIpc, history: [latestIpc] });
      // dos consultas (último valor e historial) por cada tipo de índice
      expect(mockFindMany).toHaveBeenCalledTimes(Object.values(IndexType).length * 2);
    });

    it('CP-28 / CP-53: para el último período gana la carga propia sobre la de sistema', async () => {
      const sys = row({ id: 'sys', tenantId: '__system__', value: '2.0' });
      const own = row({ id: 'own', value: '2.5' });
      mockFindMany.mockImplementation(async ({ where, take }: any) =>
        where.indexType === IndexType.IPC ? (take === 2 ? [sys, own] : [own, sys]) : [],
      );

      const result = await service.findLatest();

      expect(result[0].latest.id).toBe('own');
      expect(result[0].history.map((r: any) => r.id)).toEqual(['own']);
    });

    it('CP-28: el historial se acota a los últimos 30 días', async () => {
      mockFindMany.mockResolvedValue([row()]);
      const before = new Date();

      await service.findLatest();

      const historyCall = mockFindMany.mock.calls.find((c) => c[0].where.period);
      const gte: Date = historyCall![0].where.period.gte;
      const days = (before.getTime() - gte.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(29.9);
      expect(days).toBeLessThanOrEqual(30.1);
    });

    it('CP-28: sin filas en ningún tipo devuelve lista vacía', async () => {
      mockFindMany.mockResolvedValue([]);

      await expect(service.findLatest()).resolves.toEqual([]);
    });
  });
});
