import { Logger } from '@nestjs/common';
import { IndexScraperService } from './index-scraper.service';

// ─── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ─── Mock PrismaService ─────────────────────────────────────────────────────

const mockUpsert = jest.fn().mockResolvedValue({});
const mockPrisma = {
  baseClient: {
    indexData: { upsert: mockUpsert },
  },
} as any;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('IndexScraperService', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IndexScraperService(mockPrisma);
    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  // ── fetchICL ──────────────────────────────────────────────────────────────

  describe('fetchICL', () => {
    it('returns parsed rows from BCRA ICL endpoint (happy path)', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          status: 200,
          results: [
            {
              idVariable: 40,
              detalle: [
                { fecha: '2026-04-14', valor: 31.49 },
                { fecha: '2026-04-13', valor: 31.47 },
              ],
            },
          ],
        }),
      );

      const rows = await service.fetchICL();

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        period: '2026-04-14',
        value: 31.49,
        source: 'bcra-v4-icl',
      });
    });
  });

  // ── fetchUVA ──────────────────────────────────────────────────────────────

  describe('fetchUVA', () => {
    it('returns parsed rows from BCRA UVA endpoint (happy path)', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          status: 200,
          results: [
            {
              idVariable: 31,
              detalle: [
                { fecha: '2026-04-14', valor: 1881.02 },
                { fecha: '2026-04-13', valor: 1879.29 },
              ],
            },
          ],
        }),
      );

      const rows = await service.fetchUVA();

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        period: '2026-04-14',
        value: 1881.02,
        source: 'bcra-v4-uva',
      });
    });
  });

  // ── fetchIPC ──────────────────────────────────────────────────────────────

  describe('fetchIPC', () => {
    it('returns parsed rows from datos.gob.ar primary endpoint (happy path)', async () => {
      // La API devuelve la variación mensual como fracción (DEF-06); el
      // módulo la guarda en porcentaje. La fixture original traía niveles
      // (7045.47) y reproducía el malentendido.
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          data: [
            ['2026-02-01', 0.0295],
            ['2026-01-01', 0.0287],
            ['2025-12-01', 0.0271],
          ],
        }),
      );

      const rows = await service.fetchIPC();

      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        period: '2026-02',
        value: 2.95,
        source: 'indec-datos-gob-ar',
      });
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('representation_mode')).toBe('percent_change');
      expect(url.searchParams.get('sort')).toBe('desc');
    });
  });

  // ── upsertAll ─────────────────────────────────────────────────────────────

  describe('upsertAll', () => {
    it('fetches all three sources and returns row counts', async () => {
      // ICL response
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }],
        }),
      );
      // UVA response
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          results: [{ detalle: [{ fecha: '2026-04-14', valor: 1881.02 }] }],
        }),
      );
      // IPC response
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ data: [['2026-02-01', 7045.47]] }),
      );

      const result = await service.upsertAll();

      expect(result).toEqual({ icl: 1, uva: 1, ipc: 1 });
      expect(mockUpsert).toHaveBeenCalledTimes(3);
    });
  });

  // ── Error isolation ──────────────────────────────────────────────────────

  describe('error isolation', () => {
    it('returns empty array for ICL without throwing when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const rows = await service.fetchICL();
      expect(rows).toEqual([]);
    });

    it('returns empty array for UVA without throwing when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const rows = await service.fetchUVA();
      expect(rows).toEqual([]);
    });

    it('returns empty array for IPC without throwing when both endpoints fail', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('network error'))   // primary
        .mockRejectedValueOnce(new Error('csv error'));       // fallback

      const rows = await service.fetchIPC();
      expect(rows).toEqual([]);
    });
  });
});

// ─── Casos agregados por el plan de pruebas (docs/calidad/05-casos-de-prueba.md) ──

function makeTextResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

describe('IndexScraperService — fallos y límites', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IndexScraperService(mockPrisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('CP-29: un HTTP 500 del BCRA devuelve lista vacía y registra el error', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({}, 500));

    const rows = await service.fetchICL();

    expect(rows).toEqual([]);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'fetchICL failed — returning empty array',
      expect.stringContaining('BCRA HTTP 500'),
    );
  });

  it('CP-29: una respuesta 200 sin el campo results devuelve lista vacía sin error', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ status: 200 }));

    await expect(service.fetchUVA()).resolves.toEqual([]);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('CP-30: un error TLS reintenta una vez sin verificar el certificado y avisa', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('self signed certificate in certificate chain'))
      .mockResolvedValueOnce(
        makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }] }),
      );

    const rows = await service.fetchICL();

    expect(rows).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('TLS error'));
  });

  it('CP-30: un error de red que no es TLS no se reintenta', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(service.fetchUVA()).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('CP-31: si la API del INDEC no trae datos, usa el CSV de respaldo y descarta filas inválidas', async () => {
    // Mismas columnas que el CSV real: la 2 es el nivel y la 9 la variación mensual como fracción.
    const header = 'indice_tiempo,ipc_ng_nacional,c2,c3,c4,c5,c6,c7,ipc_ng_nacional_tasa_variacion_mensual';
    const valid = Array.from({ length: 26 }, (_, i) => {
      const month = String((i % 12) + 1).padStart(2, '0');
      const year = 2024 + Math.floor(i / 12);
      return `${year}-${month}-01,${(6000 + i * 10).toFixed(2)},0,0,0,0,0,0,${(0.01 + i * 0.001).toFixed(6)}`;
    });
    const csv = [header, '2026-01-01,abc,0,0,0,0,0,0,abc', ',', 'solo-una-columna', ...valid].join('\n');

    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ data: [] })) // primario vacío
      .mockResolvedValueOnce(makeTextResponse(csv)); // respaldo

    const rows = await service.fetchIPC();

    expect(rows).toHaveLength(24); // se conservan los últimos 24 meses
    // fila 3 (i = 2): fracción 0.012 → 1.2 %
    expect(rows[0]).toEqual({ period: '2024-03', value: 1.2, source: 'indec-csv-fallback' });
    expect(rows[23].period).toBe('2026-02');
    // Una respuesta vacía no es un error: se pasa al respaldo sin advertencia.
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('CP-31: si el CSV responde con error HTTP, devuelve lista vacía', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({}, 503))
      .mockResolvedValueOnce(makeTextResponse('', 404));

    await expect(service.fetchIPC()).resolves.toEqual([]);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('both primary and CSV fallback'),
      expect.anything(),
    );
  });

  it('CP-32: si un upsert falla, lo registra y cuenta los demás', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }] }))
      .mockResolvedValueOnce(makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 1881.02 }] }] }))
      .mockResolvedValueOnce(makeJsonResponse({ data: [['2026-02-01', 7045.47]] }));
    mockUpsert.mockRejectedValueOnce(new Error('unique violation'));

    const result = await service.upsertAll();

    expect(result).toEqual({ icl: 0, uva: 1, ipc: 1 });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upsert ICL row period=2026-04-14'),
      expect.anything(),
    );
  });

  it('CP-33: los períodos diarios y mensuales se guardan como fechas UTC bajo el identificador de sistema', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }] }))
      .mockResolvedValueOnce(makeJsonResponse({ results: [] }))
      .mockResolvedValueOnce(makeJsonResponse({ data: [['2026-02-01', 7045.47]] }));

    await service.upsertAll();

    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const icl = calls.find((c) => c.create.indexType === 'ICL');
    const ipc = calls.find((c) => c.create.indexType === 'IPC');

    expect(icl.create.period.toISOString()).toBe('2026-04-14T00:00:00.000Z');
    expect(ipc.create.period.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(icl.where.tenantId_indexType_period.tenantId).toBe('__system__');
    expect(icl.create).toMatchObject({ tenantId: '__system__', value: 31.49, source: 'bcra-v4-icl' });
  });

  it('CP-33: el rango pedido al BCRA cubre los últimos 60 días', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ results: [] }));

    await service.fetchICL();

    const url = new URL(mockFetch.mock.calls[0][0]);
    const desde = new Date(url.searchParams.get('desde')!);
    const hasta = new Date(url.searchParams.get('hasta')!);
    expect(url.pathname.endsWith('/Monetarias/40')).toBe(true);
    expect(Math.round((hasta.getTime() - desde.getTime()) / 86_400_000)).toBe(60);
  });
});
