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
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          data: [
            ['2026-02-01', 7045.47],
            ['2026-01-01', 6843.27],
            ['2025-12-01', 6652.16],
          ],
        }),
      );

      const rows = await service.fetchIPC();

      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        period: '2026-02',
        value: 7045.47,
        source: 'indec-datos-gob-ar',
      });
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
