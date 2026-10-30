import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import { PrismaService } from '../../common/prisma/prisma.service';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface IndexDataRow {
  period: string;   // YYYY-MM-DD for ICL/UVA; YYYY-MM for IPC
  value: number;
  source: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

import { SYSTEM_TENANT_ID } from './index-data.service';

const USER_AGENT = 'Mozilla/5.0 (compatible; IndexScraper/1.0)';
const FETCH_TIMEOUT_MS = 10_000;

const BCRA_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias';

/**
 * IPC, fuente principal: la distribución CSV del dataset 145 de datos.gob.ar
 * (INDEC, IPC nacional base dic-2016 = 100). La columna 8 trae la variación
 * mensual del nivel general como fracción con todos sus decimales, que es lo
 * que el motor de ajustes espera (DEF-06), y el archivo se actualiza antes que
 * la API de series del mismo portal.
 *
 * La API de series (148.3_INIVELNAL_DICI_M_26) se dejó de usar: con
 * representation_mode=percent_change y sort=desc omite el último mes
 * publicado, y además su índice va un mes atrás del CSV. El 30 de octubre de
 * 2026 devolvía julio como último dato con el CSV ya en septiembre (R-07).
 */
const INDEC_CSV_URL =
  'https://infra.datos.gob.ar/catalog/sspm/dataset/145/distribution/145.3/download/indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv';
/** Columna del CSV con la variación mensual del nivel general como fracción. */
const INDEC_CSV_VARIATION_COLUMN = 8;
const INDEC_CSV_VARIATION_HEADER = 'ipc_ng_nacional_tasa_variacion_mensual';

/**
 * IPC, fuente de respaldo: variable 27 de la API v4 del BCRA ("Inflación
 * mensual"), que replica la variación que publica el INDEC, en porcentaje y
 * con un decimal, fechada el último día del mes. Solo completa los meses que
 * el CSV todavía no trae y nunca pisa un valor ya guardado (ver upsertAll).
 */
const BCRA_IPC_VARIABLE = 27;

/** Meses de IPC que se devuelven y se guardan en cada corrida. */
const IPC_MONTHS = 24;

export const IPC_SOURCE_INDEC = 'indec-datos-gob-ar-csv';
export const IPC_SOURCE_BCRA = 'bcra-v4-ipc';

/** Fracción (0.0211) → porcentaje con seis decimales (2.113772). */
function fractionToPercent(fraction: number): number {
  return roundTo6(fraction * 100);
}

function roundTo6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const ISO_MONTH_DAY = /^(\d{4}-\d{2})-\d{2}$/;

/**
 * Une las dos fuentes del IPC por mes. Para un mismo mes gana el INDEC, que
 * trae la variación completa; el BCRA solo agrega los meses que faltan. Como
 * la clave es el mes (YYYY-MM), un mes nunca queda dos veces aunque las dos
 * fuentes lo traigan. Devuelve los últimos `months` meses, el más reciente
 * primero.
 */
export function spliceIpc(
  indec: IndexDataRow[],
  bcra: IndexDataRow[],
  months = IPC_MONTHS,
): IndexDataRow[] {
  const byMonth = new Map<string, IndexDataRow>();
  for (const row of bcra) byMonth.set(row.period, row);
  for (const row of indec) byMonth.set(row.period, row);
  return [...byMonth.values()]
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, months);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function dateRange60Days(): { desde: string; hasta: string } {
  return dateRangeDays(60);
}

function dateRangeDays(days: number): { desde: string; hasta: string } {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - days);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: fmt(desde), hasta: fmt(hasta) };
}

/**
 * Fetch with a 10 s timeout.  When `insecure` is true an HTTPS agent that
 * skips TLS verification is injected (BCRA certificate workaround).
 */
async function fetchWithTimeout(
  url: string,
  insecure = false,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const init: RequestInit = {
    signal: controller.signal,
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT },
  };

  if (insecure) {
    // Node fetch accepts a `dispatcher` (undici) or legacy `agent` option.
    // We use the undici-compatible approach via the node:https agent cast.
    (init as any).agent = new https.Agent({ rejectUnauthorized: false });
  }

  try {
    return await fetch(url, init);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a BCRA endpoint.  On TLS error, retries once with cert verification
 * disabled and logs a warning.
 */
async function fetchBcra(url: string, logger: Logger): Promise<unknown> {
  let res: Response;

  try {
    res = await fetchWithTimeout(url);
  } catch (err: unknown) {
    const isTls =
      err instanceof Error &&
      /certificate|ssl|tls|self.signed/i.test(err.message);

    if (isTls) {
      logger.warn(
        `TLS error fetching ${url} — retrying with rejectUnauthorized=false`,
      );
      res = await fetchWithTimeout(url, true);
    } else {
      throw err;
    }
  }

  if (!res.ok) {
    throw new Error(`BCRA HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class IndexScraperService {
  private readonly logger = new Logger(IndexScraperService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── ICL ──────────────────────────────────────────────────────────────────

  async fetchICL(): Promise<IndexDataRow[]> {
    const { desde, hasta } = dateRange60Days();
    const url = `${BCRA_BASE}/40?desde=${desde}&hasta=${hasta}`;

    try {
      const json = (await fetchBcra(url, this.logger)) as any;
      const detalle: Array<{ fecha: string; valor: number }> =
        json?.results?.[0]?.detalle ?? [];

      return detalle.map((d) => ({
        period: d.fecha,          // YYYY-MM-DD
        value: d.valor,
        source: 'bcra-v4-icl',
      }));
    } catch (err: unknown) {
      this.logger.error(
        'fetchICL failed — returning empty array',
        err instanceof Error ? err.stack : String(err),
      );
      return [];
    }
  }

  // ── UVA ──────────────────────────────────────────────────────────────────

  async fetchUVA(): Promise<IndexDataRow[]> {
    const { desde, hasta } = dateRange60Days();
    const url = `${BCRA_BASE}/31?desde=${desde}&hasta=${hasta}`;

    try {
      const json = (await fetchBcra(url, this.logger)) as any;
      const detalle: Array<{ fecha: string; valor: number }> =
        json?.results?.[0]?.detalle ?? [];

      return detalle.map((d) => ({
        period: d.fecha,          // YYYY-MM-DD
        value: d.valor,
        source: 'bcra-v4-uva',
      }));
    } catch (err: unknown) {
      this.logger.error(
        'fetchUVA failed — returning empty array',
        err instanceof Error ? err.stack : String(err),
      );
      return [];
    }
  }

  // ── IPC ──────────────────────────────────────────────────────────────────

  /**
   * Variación mensual del IPC en porcentaje, los últimos 24 meses, el más
   * reciente primero. Consulta las dos fuentes en paralelo y las une por mes
   * (spliceIpc): el CSV del INDEC manda y el BCRA completa los meses que el
   * CSV todavía no publicó. Si una fuente falla se sigue con la otra.
   */
  async fetchIPC(): Promise<IndexDataRow[]> {
    const [indec, bcra] = await Promise.all([
      this.fetchIpcFromIndecCsv(),
      this.fetchIpcFromBcra(),
    ]);

    if (indec.length === 0 && bcra.length === 0) {
      this.logger.error(
        'fetchIPC failed (INDEC CSV and BCRA) — returning empty array',
        'no IPC rows from any source',
      );
      return [];
    }

    return spliceIpc(indec, bcra);
  }

  /** Variación mensual del IPC desde el CSV del INDEC en datos.gob.ar. */
  async fetchIpcFromIndecCsv(): Promise<IndexDataRow[]> {
    try {
      const res = await fetchWithTimeout(INDEC_CSV_URL);
      if (!res.ok) throw new Error(`INDEC CSV HTTP ${res.status}`);

      const text = await res.text();
      const rows = text.trim().split('\n');
      const header = (rows[0] ?? '').split(',').map((c) => c.trim());
      // Si el INDEC reordena columnas, mejor no traer nada que traer otra serie.
      if (header[INDEC_CSV_VARIATION_COLUMN] !== INDEC_CSV_VARIATION_HEADER) {
        throw new Error(
          `INDEC CSV: columna ${INDEC_CSV_VARIATION_COLUMN} es "${
            header[INDEC_CSV_VARIATION_COLUMN] ?? ''
          }", se esperaba ${INDEC_CSV_VARIATION_HEADER}`,
        );
      }

      const results: IndexDataRow[] = [];
      for (const row of rows.slice(1)) {
        const cols = row.split(',');
        if (cols.length <= INDEC_CSV_VARIATION_COLUMN) continue;
        const match = ISO_MONTH_DAY.exec(cols[0].trim());
        const raw = cols[INDEC_CSV_VARIATION_COLUMN].trim();
        const val = Number(raw);
        if (!match || raw === '' || !Number.isFinite(val)) continue;
        results.push({
          period: match[1], // YYYY-MM
          value: fractionToPercent(val),
          source: IPC_SOURCE_INDEC,
        });
      }
      return results;
    } catch (err: unknown) {
      this.logger.warn(
        `IPC from INDEC CSV failed — BCRA fills in. Error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /** Inflación mensual (variable 27) desde la API v4 del BCRA. */
  async fetchIpcFromBcra(): Promise<IndexDataRow[]> {
    // 26 meses hacia atrás: alcanza para 24 meses aunque el último dato
    // tenga el rezago habitual de mes y medio.
    const { desde, hasta } = dateRangeDays(800);
    const url = `${BCRA_BASE}/${BCRA_IPC_VARIABLE}?desde=${desde}&hasta=${hasta}`;

    try {
      const json = (await fetchBcra(url, this.logger)) as any;
      const detalle: Array<{ fecha: string; valor: number }> =
        json?.results?.[0]?.detalle ?? [];

      const results: IndexDataRow[] = [];
      for (const d of detalle) {
        // fecha = último día del mes (2026-09-30): el mes sale del texto, sin
        // pasar por Date, para que la zona horaria no lo corra.
        const match = ISO_MONTH_DAY.exec(String(d.fecha ?? ''));
        if (!match || typeof d.valor !== 'number' || !Number.isFinite(d.valor)) continue;
        results.push({
          period: match[1],
          value: roundTo6(d.valor), // ya viene en porcentaje
          source: IPC_SOURCE_BCRA,
        });
      }
      return results;
    } catch (err: unknown) {
      this.logger.warn(
        `IPC from BCRA failed — INDEC CSV only. Error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  // ── Upsert All ───────────────────────────────────────────────────────────

  /**
   * Fetches ICL, UVA, and IPC data, then idempotently upserts each row into
   * the IndexData table under the SYSTEM_TENANT_ID sentinel.
   *
   * Returns the count of rows inserted/updated per source.
   */
  async upsertAll(): Promise<{ icl: number; uva: number; ipc: number }> {
    const [iclRows, uvaRows, ipcRows] = await Promise.all([
      this.fetchICL(),
      this.fetchUVA(),
      this.fetchIPC(),
    ]);

    const upsertRows = async (
      rows: IndexDataRow[],
      indexType: string,
      periodAsDate: (period: string) => Date,
    ): Promise<number> => {
      let count = 0;
      for (const row of rows) {
        try {
          await this.prisma.baseClient.indexData.upsert({
            where: {
              tenantId_indexType_period: {
                tenantId: SYSTEM_TENANT_ID,
                indexType: indexType as any,
                period: periodAsDate(row.period),
              },
            },
            // Un valor del BCRA (un decimal) solo completa un mes vacío: no
            // pisa la variación completa del INDEC ni una corrida anterior.
            update:
              row.source === IPC_SOURCE_BCRA
                ? {}
                : {
                    value: row.value,
                    source: row.source,
                  },
            create: {
              tenantId: SYSTEM_TENANT_ID,
              indexType: indexType as any,
              period: periodAsDate(row.period),
              value: row.value,
              source: row.source,
            },
          });
          count++;
        } catch (err: unknown) {
          this.logger.error(
            `Failed to upsert ${indexType} row period=${row.period}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
      return count;
    };

    // ICL/UVA: period is YYYY-MM-DD
    const dailyDate = (period: string) => new Date(period + 'T00:00:00.000Z');

    // IPC: period is YYYY-MM — store as first of month at midnight UTC
    const monthlyDate = (period: string) =>
      new Date(period + '-01T00:00:00.000Z');

    const [icl, uva, ipc] = await Promise.all([
      upsertRows(iclRows, 'ICL', dailyDate),
      upsertRows(uvaRows, 'UVA', dailyDate),
      upsertRows(ipcRows, 'IPC', monthlyDate),
    ]);

    this.logger.log(
      `upsertAll complete — ICL: ${icl}, UVA: ${uva}, IPC: ${ipc}`,
    );

    return { icl, uva, ipc };
  }
}
