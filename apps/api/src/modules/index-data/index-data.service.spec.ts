import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { IndexDataService, mergeVisibleRows } from './index-data.service';
import { TenantIsolationError } from '../../common/tenant/tenant-isolation.error';
import { IndexType } from '@realfy/shared';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindMany = jest.fn();
/** findAll resuelve la unión propia + sistema en SQL: dos consultas (página y total). */
const mockQueryRaw = jest.fn();
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
    $queryRaw: mockQueryRaw,
  },
} as any;

const visible = { tenantId: { in: ['tenant-1', '__system__'] } };

/** Texto y valores de la consulta SQL número n (0 = página, 1 = total). */
function sqlCall(n: number): { text: string; values: unknown[] } {
  const sql = mockQueryRaw.mock.calls[n][0];
  return { text: sql.sql.replace(/\s+/g, ' '), values: sql.values };
}

function mockPage(items: any[], total: number) {
  mockQueryRaw.mockResolvedValueOnce(items).mockResolvedValueOnce([{ count: total }]);
}
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
    mockQueryRaw.mockReset();
    mockQueryRaw.mockResolvedValue([]);
    mockUpsert.mockImplementation(async (args: any) => ({ id: 'row-1', ...args.create }));
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('CP-18: sin parámetros pide la primera página de 50 sobre las filas visibles y el total', async () => {
      const page = Array.from({ length: 50 }, (_, i) => row({ id: `r${i}` }));
      mockPage(page, 120);

      const result = await service.findAll({});

      const { text, values } = sqlCall(0);
      expect(text).toContain('DISTINCT ON ("indexType", "period")');
      expect(values).toEqual(expect.arrayContaining(['tenant-1', '__system__', 50, 0]));
      expect(text).toContain('ORDER BY "indexType", "period", "isEstimate" ASC, ("tenantId" = ');
      expect(text).toContain('LIMIT');
      expect(sqlCall(1).text).toContain('COUNT(*)');
      expect(result).toMatchObject({ page: 1, limit: 50, total: 120, totalPages: 3 });
      expect(result.items).toHaveLength(50);
    });

    it('CP-18: sin inmobiliaria en contexto falla cerrado (ADR-0006)', async () => {
      mockTenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.findAll({})).rejects.toThrow(TenantIsolationError);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('CP-53 (unitario): el total es el del conjunto sin duplicados que devuelve la base', async () => {
      mockPage([row({ id: 'own', source: 'manual' }), row({ id: 'sys2', tenantId: '__system__' })], 2);

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

      const { text, values } = sqlCall(0);
      expect(text).toContain('"indexType" = ');
      expect(text).toContain('"period" >= ');
      expect(text).toContain('"period" <= ');
      expect(values).toEqual(
        expect.arrayContaining([
          IndexType.ICL,
          new Date('2025-01-01T00:00:00.000Z'),
          new Date('2025-03-31T00:00:00.000Z'),
          10, // limit
          10, // offset = (2 - 1) × 10
        ]),
      );
    });

    it('CP-19: con solo periodFrom no agrega cota superior', async () => {
      await service.findAll({ periodFrom: '2025-01-01T00:00:00.000Z' });

      const { text } = sqlCall(0);
      expect(text).toContain('"period" >= ');
      expect(text).not.toContain('"period" <= ');
      expect(text).not.toContain('"indexType" = ');
    });

    it.each([
      ['page 0', { page: 0 }],
      ['limit 0', { limit: 0 }],
      ['limit 101', { limit: 101 }],
      ['page negativa', { page: -1 }],
    ])('CP-20 (límite inválido): %s responde VALIDATION_ERROR', async (_label, query) => {
      await expectValidationError(service.findAll(query));
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it.each([
      ['page 1', { page: 1 }, { page: 1, limit: 50, offset: 0 }],
      ['limit 1', { limit: 1 }, { page: 1, limit: 1, offset: 0 }],
      ['limit 100', { limit: 100 }, { page: 1, limit: 100, offset: 0 }],
      ['valores como texto', { page: '3', limit: '20' }, { page: 3, limit: 20, offset: 40 }],
    ])('CP-20 (límite válido): %s se acepta', async (_label, query, expected) => {
      mockPage([], 120);

      const result = await service.findAll(query);

      expect(result.page).toBe(expected.page);
      expect(result.limit).toBe(expected.limit);
      const { values } = sqlCall(0);
      expect(values.slice(-2)).toEqual([expected.limit, expected.offset]);
    });

    it('CP-21: un período que no es fecha responde VALIDATION_ERROR con detalle', async () => {
      await expectValidationError(service.findAll({ periodFrom: 'no-es-fecha' }));
    });

    it('CP-21: un tipo de índice fuera del enumerado responde VALIDATION_ERROR', async () => {
      await expectValidationError(service.findAll({ indexType: 'DOLAR' }));
    });

    it('CP-18: total 0 devuelve totalPages 0', async () => {
      mockPage([], 0);

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
        update: { value: '4.200000', source: 'indec', isEstimate: false, estimateSource: null },
        create: {
          tenantId: 'tenant-1',
          indexType: IndexType.IPC,
          period: new Date('2025-01-01T00:00:00.000Z'),
          value: '4.200000',
          source: 'indec',
          isEstimate: false,
          estimateSource: null,
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
      where: {
        ...visible,
        indexType: IndexType.IPC,
        isEstimate: false,
        period: { gte: start, lte: end },
      },
      orderBy: { period: 'asc' },
    });
    expect(rows.map((r) => r.value)).toEqual(['1']);
  });

  it('CP-27: getForPeriod con startExclusive deja afuera la fecha de inicio (DEF-07)', async () => {
    const start = new Date('2025-04-01T00:00:00.000Z');
    const end = new Date('2025-07-01T00:00:00.000Z');
    mockFindMany.mockResolvedValueOnce([]);

    await service.getForPeriod(IndexType.IPC, start, end, { startExclusive: true });

    expect(mockFindMany.mock.calls[0][0].where.period).toEqual({ gt: start, lte: end });
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
    it('CP-28: incluye solo los tipos que tienen al menos una fila, con dos consultas en total', async () => {
      const latestIpc = row({ id: 'ipc-1', value: '4.2' });
      mockQueryRaw.mockResolvedValueOnce([latestIpc]);
      mockFindMany.mockResolvedValueOnce([latestIpc]);

      const result = await service.findLatest();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ indexType: IndexType.IPC, latest: latestIpc, history: [latestIpc] });
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const { text, values } = sqlCall(0);
      expect(text).toContain('DISTINCT ON ("indexType")');
      expect(text).toContain('ORDER BY "indexType", "period" DESC, ("tenantId" = ');
      expect(values).toEqual(expect.arrayContaining(['tenant-1', '__system__']));
    });

    it('CP-28 / CP-53: en el historial gana la carga propia sobre la de sistema para el mismo período', async () => {
      const sys = row({ id: 'sys', tenantId: '__system__', value: '2.0' });
      const own = row({ id: 'own', value: '2.5' });
      const iclSys = row({ id: 'icl', tenantId: '__system__', indexType: IndexType.ICL });
      mockQueryRaw.mockResolvedValueOnce([own, iclSys]);
      mockFindMany.mockResolvedValueOnce([sys, own, iclSys]);

      const result = await service.findLatest();

      expect(result.map((r) => r.indexType)).toEqual([IndexType.IPC, IndexType.ICL]);
      expect(result[0].latest.id).toBe('own');
      expect(result[0].history.map((r: any) => r.id)).toEqual(['own']);
      expect(result[1].history.map((r: any) => r.id)).toEqual(['icl']);
    });

    it('CP-28: el historial se acota a los últimos 30 días y a las filas visibles', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const before = new Date();

      await service.findLatest();

      const where = mockFindMany.mock.calls[0][0].where;
      expect(where.tenantId).toEqual(visible.tenantId);
      const days = (before.getTime() - where.period.gte.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(29.9);
      expect(days).toBeLessThanOrEqual(30.1);
    });

    it('CP-28: sin filas en ningún tipo devuelve lista vacía', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await expect(service.findLatest()).resolves.toEqual([]);
    });
  });
});

describe('IndexDataService — estimados y oficiales', () => {
  const auditCreate = jest.fn();
  const auditFindMany = jest.fn();
  const adjustmentFindMany = jest.fn();
  const baseIndexFindMany = jest.fn();
  const clientFindFirst = jest.fn();
  const clientUpsert = jest.fn();
  const prisma = {
    client: { indexData: { findFirst: clientFindFirst, upsert: clientUpsert } },
    baseClient: {
      auditLog: { create: auditCreate, findMany: auditFindMany },
      indexData: { findMany: baseIndexFindMany },
      contractAdjustment: { findMany: adjustmentFindMany },
    },
  } as any;
  const context = {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
    getUserId: jest.fn().mockReturnValue('user-1'),
  } as any;
  const input = { indexType: IndexType.IPC, period: '2026-09-01T00:00:00.000Z', value: '2.500000' };
  let service: IndexDataService;

  beforeEach(() => {
    jest.resetAllMocks();
    context.getTenantId.mockReturnValue('tenant-1');
    context.getUserId.mockReturnValue('user-1');
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    clientUpsert.mockImplementation(async ({ create }: any) => ({ id: 'row-1', ...create }));
    service = new IndexDataService(prisma, context);
  });

  it('carga un estimado con su fuente', async () => {
    clientFindFirst.mockResolvedValue(null);
    await service.create({ ...input, isEstimate: true, estimateSource: 'REM' });

    expect(clientUpsert.mock.calls[0][0].create).toMatchObject({ isEstimate: true, estimateSource: 'REM' });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rechaza la fuente de estimado en un valor oficial', async () => {
    await expect(service.create({ ...input, estimateSource: 'REM' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('un estimado no pisa a un oficial ya cargado (409 OFFICIAL_VALUE_EXISTS)', async () => {
    clientFindFirst.mockResolvedValue({ id: 'row-1', isEstimate: false, value: '2.4' });

    await expect(service.create({ ...input, isEstimate: true })).rejects.toMatchObject({
      response: { error: 'OFFICIAL_VALUE_EXISTS' },
    });
    expect(clientUpsert).not.toHaveBeenCalled();
  });

  it('el oficial reemplaza al estimado bajo la misma clave y deja registro', async () => {
    clientFindFirst.mockResolvedValue({
      id: 'row-1',
      isEstimate: true,
      estimateSource: 'REM',
      value: { toString: () => '2.300000' },
    });

    await service.create(input);

    expect(clientUpsert.mock.calls[0][0].update).toMatchObject({ isEstimate: false, estimateSource: null });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        entity: 'index_estimate_replaced',
        changes: expect.objectContaining({
          indexType: 'IPC',
          estimateValue: '2.300000',
          estimateSource: 'REM',
          officialValue: '2.500000',
        }),
      }),
    });
  });

  it('mergeVisibleRows: el oficial de sistema le gana al estimado propio', () => {
    const own = row({ id: 'own', isEstimate: true });
    const sys = row({ id: 'sys', tenantId: '__system__', isEstimate: false });
    expect(mergeVisibleRows([own, sys], 'tenant-1').map((r) => r.id)).toEqual(['sys']);
    expect(mergeVisibleRows([sys, own], 'tenant-1').map((r) => r.id)).toEqual(['sys']);
  });

  it('getForPeriod puede incluir estimados cuando se pide', async () => {
    baseIndexFindMany.mockResolvedValue([]);
    await service.getForPeriod(IndexType.IPC, new Date(0), new Date(1), { includeEstimates: true });
    expect(baseIndexFindMany.mock.calls[0][0].where).not.toHaveProperty('isEstimate');
  });

  describe('estimates-replaced', () => {
    it('reúne reemplazos manuales y publicados, con los contratos a corregir', async () => {
      auditFindMany.mockResolvedValue([
        {
          createdAt: new Date('2026-10-02T10:00:00.000Z'),
          changes: {
            indexType: 'IPC',
            period: '2026-08-01T00:00:00.000Z',
            estimateValue: '2.1',
            estimateSource: 'REM',
            officialValue: '2.4',
          },
        },
      ]);
      const estimate = {
        indexType: 'IPC',
        period: new Date('2026-09-01T00:00:00.000Z'),
        value: { toString: () => '2.2' },
        estimateSource: 'REM',
      };
      baseIndexFindMany
        .mockResolvedValueOnce([estimate])
        .mockResolvedValueOnce([
          {
            indexType: 'IPC',
            period: estimate.period,
            value: { toString: () => '2.6' },
            createdAt: new Date('2026-10-15T00:00:00.000Z'),
          },
        ]);
      adjustmentFindMany.mockResolvedValue([{ contractId: 'c1' }, { contractId: 'c1' }, { contractId: 'c2' }]);

      const result = await service.findEstimatesReplaced('2026-10-01');

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ via: 'manual', estimateValue: '2.1', officialValue: '2.4' });
      expect(result.items[1]).toMatchObject({ via: 'published', estimateValue: '2.2', officialValue: '2.6' });
      expect(result.items[0].contractIds).toEqual(['c1', 'c2']);
      expect(adjustmentFindMany.mock.calls[0][0].where).toMatchObject({
        tenantId: 'tenant-1',
        isProvisional: true,
        trueUpOfId: null,
      });
    });

    it('sin estimados ni reemplazos devuelve la lista vacía', async () => {
      auditFindMany.mockResolvedValue([]);
      baseIndexFindMany.mockResolvedValue([]);
      await expect(service.findEstimatesReplaced()).resolves.toMatchObject({ items: [] });
    });

    it('rechaza una fecha inválida', async () => {
      await expect(service.findEstimatesReplaced('ayer')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('exige inmobiliaria en contexto', async () => {
      context.getTenantId.mockReturnValue(undefined);
      await expect(service.findEstimatesReplaced()).rejects.toBeInstanceOf(TenantIsolationError);
    });
  });
});
