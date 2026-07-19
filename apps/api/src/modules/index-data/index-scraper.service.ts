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

/** Sentinel tenant ID for globally shared (non-tenant) index data. */
const SYSTEM_TENANT_ID = '__system__';

const USER_AGENT = 'Mozilla/5.0 (compatible; IndexScraper/1.0)';
const FETCH_TIMEOUT_MS = 10_000;

const BCRA_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias';
const INDEC_SERIES_URL =
  'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json&limit=24';
const INDEC_CSV_FALLBACK_URL =
  'https://infra.datos.gob.ar/catalog/sspm/dataset/145/distribution/145.3/download/indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv';

// ─── Helpers ───────────────────────────────────────────────────────────────

function dateRange60Days(): { desde: string; hasta: string } {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - 60);

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

  async fetchIPC(): Promise<IndexDataRow[]> {
    // Primary: datos.gob.ar JSON API
    try {
      const res = await fetchWithTimeout(INDEC_SERIES_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as any;
      const data: Array<[string, number]> = json?.data ?? [];

      if (data.length > 0) {
        return data.map(([dateStr, val]) => ({
          period: dateStr.substring(0, 7),   // YYYY-MM
          value: val,
          source: 'indec-datos-gob-ar',
        }));
      }
    } catch (err: unknown) {
      this.logger.warn(
        `IPC primary endpoint failed — trying CSV fallback. Error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Fallback: CSV download
    try {
      const res = await fetchWithTimeout(INDEC_CSV_FALLBACK_URL);
      if (!res.ok) throw new Error(`CSV fallback HTTP ${res.status}`);

      const text = await res.text();
      const rows = text.trim().split('\n');
      // Skip header row; columns: indice_tiempo,ipc_ng_nacional,...
      const results: IndexDataRow[] = [];
      for (const row of rows.slice(1)) {
        const cols = row.split(',');
        if (cols.length < 2) continue;
        const dateStr = cols[0].trim();
        const val = parseFloat(cols[1].trim());
        if (!dateStr || isNaN(val)) continue;
        results.push({
          period: dateStr.substring(0, 7),   // YYYY-MM
          value: val,
          source: 'indec-csv-fallback',
        });
      }
      // Keep most recent 24 months
      return results.slice(-24);
    } catch (err: unknown) {
      this.logger.error(
        'fetchIPC failed (both primary and CSV fallback) — returning empty array',
        err instanceof Error ? err.stack : String(err),
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
            update: {
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
