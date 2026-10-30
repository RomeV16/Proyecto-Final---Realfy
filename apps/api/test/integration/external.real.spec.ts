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
const INDEC_CSV =
  'https://infra.datos.gob.ar/catalog/sspm/dataset/145/distribution/145.3/download/indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv';

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / DAY_MS;
/** El dato más reciente del IPC se publica con hasta dos meses de rezago. */
const IPC_MAX_AGE_DAYS = 120;

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

describe('BCRA — inflación mensual, respaldo del IPC (CP-51)', () => {
  it('la variable 27 responde 200 con un dato por mes, en porcentaje y reciente', async () => {
    const desde = isoDay(new Date(Date.now() - 800 * DAY_MS));
    const { status, body } = await fetchWithRetry(`${BCRA_BASE}/27?desde=${desde}&hasta=${isoDay(new Date())}`);

    expect(status).toBe(200);
    const detalle: { fecha: string; valor: number }[] = JSON.parse(body).results[0].detalle;
    expect(detalle.length).toBeGreaterThanOrEqual(24);
    const months = detalle.map((r) => r.fecha.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
    for (const row of detalle) {
      expect(row.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.valor).toBe('number');
      // En porcentaje (1.9), no como fracción (0.019) ni como nivel.
      expect(row.valor).toBeGreaterThan(-5);
      expect(row.valor).toBeLessThan(30);
    }
    const newest = months.sort().at(-1)!;
    expect(daysAgo(`${newest}-01`)).toBeLessThan(IPC_MAX_AGE_DAYS);
  });
});

describe('INDEC — CSV del IPC en datos.gob.ar (CP-52)', () => {
  it('responde 200 con la columna de variación mensual donde el módulo la lee', async () => {
    const { status, body } = await fetchWithRetry(INDEC_CSV);

    expect(status).toBe(200);
    const header = body.split('\n')[0].split(',').map((c) => c.trim());
    expect(header[0]).toBe('indice_tiempo');
    expect(header).toContain('ipc_ng_nacional');
    expect(header.indexOf('ipc_ng_nacional_tasa_variacion_mensual')).toBe(8);
    expect(body.trim().split('\n').length).toBeGreaterThan(100);
  });

  it('trae variaciones mensuales recientes como fracción', async () => {
    const { body } = await fetchWithRetry(INDEC_CSV);

    const rows = body
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','))
      .filter((cols) => cols[8] !== undefined && cols[8].trim() !== '');
    const last24 = rows.slice(-24);
    expect(last24).toHaveLength(24);
    expect(daysAgo(last24.at(-1)![0])).toBeLessThan(IPC_MAX_AGE_DAYS);
    for (const cols of last24) {
      expect(cols[0]).toMatch(/^\d{4}-\d{2}-01$/);
      const value = Number(cols[8]);
      expect(value).toBeGreaterThan(-0.05);
      expect(value).toBeLessThan(0.3);
    }
  });
});
