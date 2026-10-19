/**
 * CP-50 — Contrato con BCRA e INDEC usando respuestas reales grabadas
 * (apps/api/test/fixtures/external/, capturadas el 19 de octubre de 2026).
 *
 * Verifica que el parser del módulo produzca, a partir de lo que los
 * organismos devuelven de verdad, exactamente las filas que el resto del
 * sistema espera. Ver docs/calidad/07-integracion-externa.md.
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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

describe('Contrato BCRA / INDEC con respuestas reales grabadas (CP-50)', () => {
  let service: IndexScraperService;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('IPC (API de series): pide variación mensual descendente y la guarda en porcentaje', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(fixture('indec-series-pct-desc-2026-10-19.json')));

    const rows = await service.fetchIPC();

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('sort')).toBe('desc');
    expect(url.searchParams.get('representation_mode')).toBe('percent_change');

    expect(rows).toHaveLength(24);
    // 0.021137724267861868 (fracción) → 2.113772 % con seis decimales
    expect(rows[0]).toEqual({ period: '2026-07', value: 2.113772, source: 'indec-datos-gob-ar' });
    expect(rows[23].period).toBe('2024-08');
    for (const row of rows) {
      expect(row.period).toMatch(ISO_MONTH);
      expect(Math.abs(row.value)).toBeLessThan(30);
    }
  });

  it('IPC (respaldo CSV): toma la columna de variación mensual, en porcentaje, de las últimas 24 filas', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse('{"data": []}'))
      .mockResolvedValueOnce(textResponse(fixture('indec-ipc-2026-10-19.csv')));

    const rows = await service.fetchIPC();

    expect(rows).toHaveLength(24);
    expect(rows[23]).toEqual({ period: '2026-09', value: 1.933610, source: 'indec-csv-fallback' });
    expect(rows.every((r) => ISO_MONTH.test(r.period) && Math.abs(r.value) < 30)).toBe(true);
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
