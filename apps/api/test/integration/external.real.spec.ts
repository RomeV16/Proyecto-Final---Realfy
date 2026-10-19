/**
 * CP-51 / CP-52 — Contrato con BCRA e INDEC contra el entorno real.
 *
 * No usa dobles: pega a los organismos y verifica que el esquema siga
 * siendo el que el módulo espera y que los datos sean recientes. Reintenta
 * tres veces con espera para distinguir una caída transitoria (R-07) de un
 * cambio de contrato. Corre con `pnpm --filter @realfy/api test:integracion-real`.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; IndexScraper/1.0)';
const BCRA_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias';
const INDEC_SERIES = 'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json';
const INDEC_CSV =
  'https://infra.datos.gob.ar/catalog/sspm/dataset/145/distribution/145.3/download/indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv';

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / DAY_MS;

async function fetchWithRetry(url: string, attempts = 3): Promise<{ status: number; body: string }> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      });
      const body = await res.text();
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, body };
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 3_000 * i));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Sin respuesta de ${url} tras ${attempts} intentos: ${String(lastError)}`);
}

describe('BCRA — API de estadísticas v4.0 (CP-51)', () => {
  const desde = isoDay(new Date(Date.now() - 60 * DAY_MS));
  const hasta = isoDay(new Date());

  it.each([
    ['ICL', 40, 1, 1000],
    ['UVA', 31, 100, 1_000_000],
  ])('%s (variable %i) responde 200 con filas diarias recientes', async (_name, variable, min, max) => {
    const { status, body } = await fetchWithRetry(`${BCRA_BASE}/${variable}?desde=${desde}&hasta=${hasta}`);

    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json.status).toBe(200);
    expect(Array.isArray(json.results)).toBe(true);

    const detalle: { fecha: string; valor: number }[] = json.results[0].detalle;
    expect(detalle.length).toBeGreaterThanOrEqual(30);
    for (const row of detalle) {
      expect(row.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.valor).toBe('number');
      expect(row.valor).toBeGreaterThan(min);
      expect(row.valor).toBeLessThan(max);
    }
    const newest = detalle.map((r) => r.fecha).sort().at(-1)!;
    expect(daysAgo(newest)).toBeLessThan(10);
  });
});

describe('INDEC — API de series de datos.gob.ar (CP-52)', () => {
  it('el pedido actual del módulo responde 200 con pares [fecha, valor]', async () => {
    const { status, body } = await fetchWithRetry(`${INDEC_SERIES}&limit=24`);

    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(24);
    for (const [date, value] of json.data) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof value).toBe('number');
    }
  });

  it('con sort=desc y percent_change devuelve variaciones mensuales recientes como fracción', async () => {
    const { status, body } = await fetchWithRetry(
      `${INDEC_SERIES}&limit=24&sort=desc&representation_mode=percent_change`,
    );

    expect(status).toBe(200);
    const data: [string, number][] = JSON.parse(body).data;
    expect(data).toHaveLength(24);
    // El dato más reciente del IPC se publica con hasta dos meses de rezago.
    expect(daysAgo(data[0][0])).toBeLessThan(120);
    for (const [, value] of data) {
      expect(value).toBeGreaterThan(-0.05);
      expect(value).toBeLessThan(0.3);
    }
  });

  it('el CSV de respaldo responde 200 con la columna de variación mensual', async () => {
    const { status, body } = await fetchWithRetry(INDEC_CSV);

    expect(status).toBe(200);
    const header = body.split('\n')[0].split(',');
    expect(header[0]).toBe('indice_tiempo');
    expect(header).toContain('ipc_ng_nacional');
    expect(header).toContain('ipc_ng_nacional_tasa_variacion_mensual');
    expect(body.trim().split('\n').length).toBeGreaterThan(100);
  });
});
