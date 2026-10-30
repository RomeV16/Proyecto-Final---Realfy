/**
 * CP-50 — Contrato con BCRA e INDEC usando respuestas reales grabadas
 * (apps/api/test/fixtures/external/, capturadas el 19 de octubre de 2026).
 *
 * Verifica que el parser del módulo produzca, a partir de lo que los
 * organismos devuelven de verdad, exactamente las filas que el resto del
 * sistema espera. Ver docs/calidad/07-integracion-externa.md.
 *
 * La variable 27 del BCRA (inflación mensual) se grabó el 30 de octubre de
 * 2026, cuando el IPC pasó a leerse del CSV del INDEC con el BCRA de respaldo.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { IndexScraperService } from '../../src/modules/index-data/index-scraper.service';

const FIXTURES = join(__dirname, '..', 'fixtures', 'external');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/** Responde según la URL: el IPC pide el CSV y el BCRA en paralelo. */
function routeIpc(csv: Response | Error, bcra: Response | Error) {
  mockFetch.mockImplementation((url: string) => {
    const route = url.includes('/Monetarias/27') ? bcra : csv;
    return route instanceof Error ? Promise.reject(route) : Promise.resolve(route);
  });
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

describe('Contrato BCRA / INDEC con respuestas reales grabadas (CP-50)', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    service = new IndexScraperService({ baseClient: { indexData: { upsert: jest.fn() } } } as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('ICL: 61 filas diarias con fecha ISO y nivel positivo, la más reciente primero', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(fixture('bcra-icl-2026-10-19.json')));

    const rows = await service.fetchICL();

    expect(rows).toHaveLength(61);
    expect(rows[0]).toEqual({ period: '2026-10-19', value: 36.94, source: 'bcra-v4-icl' });
    expect(rows[60]).toEqual({ period: '2026-08-20', value: 35.37, source: 'bcra-v4-icl' });
    for (const row of rows) {
      expect(row.period).toMatch(ISO_DAY);
      expect(Number.isFinite(row.value) && row.value > 0).toBe(true);
    }
  });

  it('UVA: 61 filas diarias con nivel en pesos', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(fixture('bcra-uva-2026-10-19.json')));

    const rows = await service.fetchUVA();

    expect(rows).toHaveLength(61);
    expect(rows[0]).toEqual({ period: '2026-10-19', value: 2159.1, source: 'bcra-v4-uva' });
    expect(rows.every((r) => ISO_DAY.test(r.period) && r.value > 1000)).toBe(true);
  });

  it('IPC (CSV del INDEC + BCRA): 24 meses en porcentaje, hasta septiembre de 2026, sin meses repetidos', async () => {
    routeIpc(
      textResponse(fixture('indec-ipc-2026-10-19.csv')),
      jsonResponse(fixture('bcra-ipc-2026-10-30.json')),
    );

    const rows = await service.fetchIPC();

    expect(rows).toHaveLength(24);
    // 0.01933610203208236 (fracción) → 1.933610 % con seis decimales
    expect(rows[0]).toEqual({ period: '2026-09', value: 1.93361, source: 'indec-datos-gob-ar-csv' });
    expect(rows[1]).toEqual({ period: '2026-08', value: 1.659206, source: 'indec-datos-gob-ar-csv' });
    expect(rows[23].period).toBe('2024-10');
    expect(new Set(rows.map((r) => r.period)).size).toBe(24);
    for (const row of rows) {
      expect(row.period).toMatch(ISO_MONTH);
      expect(Math.abs(row.value)).toBeLessThan(30);
    }
  });

  it('IPC (solo BCRA): la variable 27 trae la misma variación redondeada a un decimal', async () => {
    routeIpc(textResponse('', 503), jsonResponse(fixture('bcra-ipc-2026-10-30.json')));

    const rows = await service.fetchIPC();

    expect(rows).toHaveLength(24);
    expect(rows[0]).toEqual({ period: '2026-09', value: 1.9, source: 'bcra-v4-ipc' });
    expect(rows[1]).toEqual({ period: '2026-08', value: 1.7, source: 'bcra-v4-ipc' });
    expect(rows.every((r) => ISO_MONTH.test(r.period))).toBe(true);
  });

  it('IPC (CSV y BCRA coinciden): cada mes del BCRA es la variación del INDEC redondeada', async () => {
    routeIpc(textResponse(fixture('indec-ipc-2026-10-19.csv')), new Error('sin BCRA'));
    const indec = await service.fetchIPC();
    routeIpc(new Error('sin CSV'), jsonResponse(fixture('bcra-ipc-2026-10-30.json')));
    const bcra = await service.fetchIPC();

    const byMonth = new Map(indec.map((r) => [r.period, r.value]));
    for (const row of bcra) {
      expect(Math.abs(row.value - byMonth.get(row.period)!)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('API de series (documenta R-07): con sort=desc y percent_change el último mes que trae es julio', () => {
    // Grabada el mismo día que el CSV, que ya llegaba a septiembre. Por eso
    // el módulo dejó de leer el IPC de la API de series.
    const data: [string, number][] = JSON.parse(fixture('indec-series-pct-desc-2026-10-19.json')).data;
    const csvLast = fixture('indec-ipc-2026-10-19.csv').trim().split('\n').at(-1)!.split(',')[0];

    expect(data[0][0]).toBe('2026-07-01');
    expect(csvLast).toBe('2026-09-01');
  });

  it('IPC (fixture del pedido viejo, documenta DEF-06): la serie sin parámetros llega como nivel desde 2016', () => {
    const data: [string, number][] = JSON.parse(fixture('indec-series-limit24-2026-10-19.json')).data;

    expect(data[0]).toEqual(['2016-12-01', 100]);
    expect(data[23][0]).toBe('2018-11-01');
  });

  it('el CSV real tiene la columna de variación mensual que el motor necesita', () => {
    const header = fixture('indec-ipc-2026-10-19.csv').split('\n')[0].split(',');

    expect(header[0]).toBe('indice_tiempo');
    expect(header[1]).toBe('ipc_ng_nacional');
    expect(header.indexOf('ipc_ng_nacional_tasa_variacion_mensual')).toBe(8);
  });
});
