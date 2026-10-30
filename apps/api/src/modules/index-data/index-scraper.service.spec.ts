import { Logger } from '@nestjs/common';
import {
  IndexScraperService,
  IPC_SOURCE_BCRA,
  IPC_SOURCE_INDEC,
  spliceIpc,
} from './index-scraper.service';

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

function makeTextResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

// ─── IPC: CSV del INDEC y variable 27 del BCRA ──────────────────────────────

const CSV_HEADER =
  'indice_tiempo,ipc_ng_nacional,c2,c3,c4,c5,c6,c7,ipc_ng_nacional_tasa_variacion_mensual';

/** CSV con las mismas columnas que el real: la 2 es el nivel y la 9 la variación como fracción. */
function ipcCsv(rows: Array<[string, number]>): string {
  return [CSV_HEADER, ...rows.map(([month, fraction]) => `${month}-01,1000,0,0,0,0,0,0,${fraction}`)].join('\n');
}

/** Respuesta de la variable 27 del BCRA: fecha = último día del mes, valor en %. */
function bcraIpc(rows: Array<[string, number]>) {
  return { status: 200, results: [{ idVariable: 27, detalle: rows.map(([fecha, valor]) => ({ fecha, valor })) }] };
}

type Route = Response | Error | undefined;

/**
 * Responde según la URL pedida y no según el orden de las llamadas: el IPC
 * consulta sus dos fuentes en paralelo con ICL y UVA.
 */
function routeFetch(routes: { icl?: Route; uva?: Route; indecCsv?: Route; bcraIpc?: Route }) {
  mockFetch.mockImplementation((url: string) => {
    const route = url.includes('/Monetarias/40')
      ? routes.icl
      : url.includes('/Monetarias/31')
        ? routes.uva
        : url.includes('/Monetarias/27')
          ? routes.bcraIpc
          : url.includes('infra.datos.gob.ar')
            ? routes.indecCsv
            : undefined;
    if (route instanceof Error) return Promise.reject(route);
    if (!route) return Promise.reject(new Error(`unexpected fetch ${url}`));
    return Promise.resolve(route);
  });
}

describe('IndexScraperService', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
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
    it('toma la variación del CSV del INDEC en porcentaje y completa con el BCRA el mes que falta', async () => {
      routeFetch({
        indecCsv: makeTextResponse(ipcCsv([['2026-07', 0.021137724267861868], ['2026-08', 0.016592064235202875]])),
        bcraIpc: makeJsonResponse(bcraIpc([['2026-09-30', 1.9], ['2026-08-31', 1.7], ['2026-07-31', 2.1]])),
      });

      const rows = await service.fetchIPC();

      // Septiembre solo lo tiene el BCRA; agosto y julio, los dos: gana el INDEC.
      expect(rows).toEqual([
        { period: '2026-09', value: 1.9, source: IPC_SOURCE_BCRA },
        { period: '2026-08', value: 1.659206, source: IPC_SOURCE_INDEC },
        { period: '2026-07', value: 2.113772, source: IPC_SOURCE_INDEC },
      ]);
      const bcraUrl = mockFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/Monetarias/'));
      expect(new URL(bcraUrl!).pathname.endsWith('/Monetarias/27')).toBe(true);
    });

    it('no pide la API de series de datos.gob.ar, que omite el último mes con sort=desc', async () => {
      routeFetch({ indecCsv: makeTextResponse(ipcCsv([['2026-09', 0.0193]])), bcraIpc: makeJsonResponse(bcraIpc([])) });

      await service.fetchIPC();

      const urls = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('apis.datos.gob.ar/series'))).toBe(false);
    });
  });

  // ── upsertAll ─────────────────────────────────────────────────────────────

  describe('upsertAll', () => {
    it('fetches all three sources and returns row counts', async () => {
      routeFetch({
        icl: makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }] }),
        uva: makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 1881.02 }] }] }),
        indecCsv: makeTextResponse(ipcCsv([['2026-02', 0.0295]])),
        bcraIpc: makeJsonResponse(bcraIpc([['2026-02-28', 2.9]])),
      });

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

    it('returns empty array for IPC without throwing when both sources fail', async () => {
      routeFetch({ indecCsv: new Error('csv error'), bcraIpc: new Error('network error') });

      const rows = await service.fetchIPC();
      expect(rows).toEqual([]);
    });
  });
});

// ─── Casos agregados por el plan de pruebas (docs/calidad/05-casos-de-prueba.md) ──

describe('IndexScraperService — fallos y límites', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
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

  it('CP-31: si el BCRA falla, usa solo el CSV del INDEC y descarta filas inválidas', async () => {
    const valid = Array.from({ length: 26 }, (_, i) => {
      const month = String((i % 12) + 1).padStart(2, '0');
      const year = 2024 + Math.floor(i / 12);
      return `${year}-${month}-01,${(6000 + i * 10).toFixed(2)},0,0,0,0,0,0,${(0.01 + i * 0.001).toFixed(6)}`;
    });
    const csv = [
      CSV_HEADER,
      '2026-01-01,abc,0,0,0,0,0,0,abc',
      '2026-03-01,1,0,0,0,0,0,0,',
      ',',
      'solo-una-columna',
      ...valid,
    ].join('\n');
    routeFetch({ indecCsv: makeTextResponse(csv), bcraIpc: makeJsonResponse({}, 500) });

    const rows = await service.fetchIPC();

    expect(rows).toHaveLength(24); // se conservan los últimos 24 meses
    // fila 26 (i = 25): fracción 0.035 → 3.5 %; fila 3 (i = 2): 0.012 → 1.2 %
    expect(rows[0]).toEqual({ period: '2026-02', value: 3.5, source: IPC_SOURCE_INDEC });
    expect(rows[23]).toEqual({ period: '2024-03', value: 1.2, source: IPC_SOURCE_INDEC });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('IPC from BCRA failed'));
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('CP-31: si el CSV responde con error HTTP, el IPC sale del BCRA', async () => {
    routeFetch({
      indecCsv: makeTextResponse('', 404),
      bcraIpc: makeJsonResponse(bcraIpc([['2026-09-30', 1.9], ['2026-08-31', 1.7]])),
    });

    const rows = await service.fetchIPC();

    expect(rows).toEqual([
      { period: '2026-09', value: 1.9, source: IPC_SOURCE_BCRA },
      { period: '2026-08', value: 1.7, source: IPC_SOURCE_BCRA },
    ]);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('INDEC CSV HTTP 404'));
  });

  it('CP-31: si fallan el CSV y el BCRA, devuelve lista vacía y registra el error', async () => {
    routeFetch({ indecCsv: makeTextResponse('', 404), bcraIpc: makeJsonResponse({}, 503) });

    await expect(service.fetchIPC()).resolves.toEqual([]);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('INDEC CSV and BCRA'),
      expect.anything(),
    );
  });

  it('CP-31: si el CSV cambia el orden de las columnas, no lee otra serie como si fuera el IPC', async () => {
    const reordered = [
      'indice_tiempo,ipc_ng_nacional,c2,c3,c4,c5,c6,c7,ipc_ng_gba_tasa_variacion_mensual',
      '2026-09-01,1,0,0,0,0,0,0,0.5',
    ].join('\n');
    routeFetch({
      indecCsv: makeTextResponse(reordered),
      bcraIpc: makeJsonResponse(bcraIpc([['2026-09-30', 1.9]])),
    });

    const rows = await service.fetchIPC();

    expect(rows).toEqual([{ period: '2026-09', value: 1.9, source: IPC_SOURCE_BCRA }]);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('ipc_ng_nacional_tasa_variacion_mensual'),
    );
  });

  it('CP-31: la fecha de fin de mes del BCRA queda en su mes, también en febrero y en diciembre', async () => {
    routeFetch({
      indecCsv: new Error('down'),
      bcraIpc: makeJsonResponse(
        bcraIpc([['2026-02-28', 2.9], ['2025-12-31', 2.8], ['sin-fecha', 1], ['2025-11-30', NaN]]),
      ),
    });

    const rows = await service.fetchIPC();

    expect(rows.map((r) => r.period)).toEqual(['2026-02', '2025-12']);
  });

  it('CP-32: si un upsert falla, lo registra y cuenta los demás', async () => {
    routeFetch({
      icl: makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }] }),
      uva: makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 1881.02 }] }] }),
      indecCsv: makeTextResponse(ipcCsv([['2026-02', 0.0295]])),
      bcraIpc: makeJsonResponse(bcraIpc([])),
    });
    mockUpsert.mockRejectedValueOnce(new Error('unique violation'));

    const result = await service.upsertAll();

    expect(result).toEqual({ icl: 0, uva: 1, ipc: 1 });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upsert ICL row period=2026-04-14'),
      expect.anything(),
    );
  });

  it('CP-33: los períodos diarios y mensuales se guardan como fechas UTC bajo el identificador de sistema', async () => {
    routeFetch({
      icl: makeJsonResponse({ results: [{ detalle: [{ fecha: '2026-04-14', valor: 31.49 }] }] }),
      uva: makeJsonResponse({ results: [] }),
      indecCsv: makeTextResponse(ipcCsv([['2026-02', 0.0295]])),
      bcraIpc: makeJsonResponse(bcraIpc([])),
    });

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
    routeFetch({ icl: makeJsonResponse({ results: [] }) });

    await service.fetchICL();

    const url = new URL(mockFetch.mock.calls[0][0]);
    const desde = new Date(url.searchParams.get('desde')!);
    const hasta = new Date(url.searchParams.get('hasta')!);
    expect(url.pathname.endsWith('/Monetarias/40')).toBe(true);
    expect(Math.round((hasta.getTime() - desde.getTime()) / 86_400_000)).toBe(60);
  });
});

describe('IndexScraperService — empalme del IPC entre INDEC y BCRA', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    service = new IndexScraperService(mockPrisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('un mes que traen las dos fuentes queda una sola vez, con el valor del INDEC', () => {
    const indec = [{ period: '2026-08', value: 1.659206, source: IPC_SOURCE_INDEC }];
    const bcra = [
      { period: '2026-09', value: 1.9, source: IPC_SOURCE_BCRA },
      { period: '2026-08', value: 1.7, source: IPC_SOURCE_BCRA },
    ];

    const rows = spliceIpc(indec, bcra);

    expect(rows).toEqual([
      { period: '2026-09', value: 1.9, source: IPC_SOURCE_BCRA },
      { period: '2026-08', value: 1.659206, source: IPC_SOURCE_INDEC },
    ]);
    expect(new Set(rows.map((r) => r.period)).size).toBe(rows.length);
  });

  it('se queda con los meses más recientes cuando la unión supera el tope', () => {
    const indec = Array.from({ length: 30 }, (_, i) => ({
      period: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      value: 1,
      source: IPC_SOURCE_INDEC,
    }));

    const rows = spliceIpc(indec, [{ period: '2026-07', value: 2, source: IPC_SOURCE_BCRA }], 3);

    expect(rows.map((r) => r.period)).toEqual(['2026-07', '2026-06', '2026-05']);
  });

  it('un valor del BCRA solo crea el mes si falta; el del INDEC actualiza el guardado', async () => {
    routeFetch({
      icl: makeJsonResponse({ results: [] }),
      uva: makeJsonResponse({ results: [] }),
      indecCsv: makeTextResponse(ipcCsv([['2026-08', 0.016592064235202875]])),
      bcraIpc: makeJsonResponse(bcraIpc([['2026-09-30', 1.9], ['2026-08-31', 1.7]])),
    });

    const result = await service.upsertAll();

    expect(result.ipc).toBe(2);
    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const sep = calls.find((c) => c.create.period.toISOString() === '2026-09-01T00:00:00.000Z');
    const aug = calls.find((c) => c.create.period.toISOString() === '2026-08-01T00:00:00.000Z');
    expect(sep.create).toMatchObject({ indexType: 'IPC', value: 1.9, source: IPC_SOURCE_BCRA });
    expect(sep.update).toEqual({});
    expect(aug.update).toEqual({ value: 1.659206, source: IPC_SOURCE_INDEC });
  });
});
